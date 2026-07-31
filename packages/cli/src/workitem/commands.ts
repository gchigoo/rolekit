import { resolve } from 'node:path'
import {
  applyProcessGateAction,
  approveWorkItemGate,
  autoBridgeToVerifying,
  dropWorkItem,
  evaluate,
  InvalidTransition,
  type Lane,
  latestRecoveryRunsCount,
  rejectWorkItemGate,
  resumeWorkItem,
  transition,
  type WorkItem,
} from '@rolekit/core'
import { loadGatePolicy, RunManager } from '@rolekit/runner'
import { WorkItemCliError } from './errors.ts'
import { startWorkItem } from './start.ts'
import { WorkItemStore } from './store.ts'

const KINDS = new Set(['feature', 'issue', 'refactor', 'research', 'goal'])
const STATUSES = new Set([
  'planned',
  'designing',
  'awaiting-gate',
  'executing',
  'verifying',
  'done',
  'dropped',
  'blocked',
])
const LANES = new Set(['direct', 'delegated', 'coordinated'])

/**
 * Dispatch rolekit workitem <sub> ...
 */
export async function cmdWorkItem(
  args: string[],
  json: boolean,
  projectRoot: string,
): Promise<void> {
  const sub = args[0]
  if (!sub || sub === '--help' || sub === '-h') {
    usageWorkitem()
    return
  }
  const store = new WorkItemStore(projectRoot)
  const rest = args.slice(1)

  if (sub === 'create') {
    const parsed = parseCreate(rest)
    const item = await store.create(parsed)
    emitSuccess(json, { item })
    return
  }
  if (sub === 'list') {
    const filters = parseList(rest)
    let items = await store.listAll()
    if (filters.status) items = items.filter((i) => i.status === filters.status)
    if (filters.kind) items = items.filter((i) => i.kind === filters.kind)
    items.sort((a, b) => a.created.localeCompare(b.created))
    if (json) emitJson({ items })
    else {
      for (const i of items) {
        process.stdout.write(`${i.id}\t${i.kind}\t${i.status}\t${i.title}\n`)
      }
    }
    process.exitCode = 0
    return
  }
  if (sub === 'next') {
    parseNoExtra(rest)
    const items = await store.listAll()
    const byId = new Map(items.map((i) => [i.id, i]))
    const candidates: Array<{ item: WorkItem; warnings: string[] }> = []
    for (const item of items) {
      if (item.status !== 'planned') continue
      const warnings: string[] = []
      let ready = true
      for (const depId of item.depends_on) {
        const dep = byId.get(depId)
        if (!dep || (dep.status !== 'done' && dep.status !== 'dropped')) {
          ready = false
          break
        }
        if (dep.status === 'dropped') warnings.push(`dependency_dropped:${depId}`)
      }
      if (ready) candidates.push({ item, warnings })
    }
    candidates.sort((a, b) => a.item.created.localeCompare(b.item.created))
    const first = candidates[0]
    if (!first) {
      throw new WorkItemCliError('no_ready_item', { exitCode: 1 })
    }
    if (json) emitJson({ item: first.item, warnings: first.warnings })
    else {
      process.stdout.write(`${first.item.id}\t${first.item.title}\n`)
      for (const w of first.warnings) process.stderr.write(`warning: ${w}\n`)
    }
    process.exitCode = 0
    return
  }
  if (sub === 'design') {
    const id = requireId(rest)
    const item = await store.withLock(async () => {
      const cur = await store.read(id)
      try {
        const next = transition(cur.item, 'designing')
        await store.write(next, cur.revision)
        return next
      } catch (error) {
        if (error instanceof InvalidTransition) {
          throw new WorkItemCliError('invalid_transition', { id, detail: error.message })
        }
        throw error
      }
    })
    emitSuccess(json, { item })
    return
  }
  if (sub === 'start') {
    const flags = parseStart(rest)
    const rm = new RunManager(projectRoot)
    const result = await startWorkItem(store, rm, flags.id, flags)
    if (result.exitCode !== 0 || result.error) {
      const error = result.error ?? 'workitem_start_failed'
      if (json) {
        emitJson({
          error,
          id: flags.id,
          ...(result.run_id ? { run_id: result.run_id } : {}),
          ...(result.next_action ? { next_action: result.next_action } : {}),
          item: result.item,
        })
      } else {
        process.stderr.write(`${error}${result.run_id ? ` ${result.run_id}` : ''}\n`)
      }
      process.exitCode = result.exitCode || 1
      return
    }
    emitSuccess(json, {
      item: result.item,
      ...(result.run_id ? { run_id: result.run_id } : {}),
      ...(result.no_op ? { no_op: true } : {}),
    })
    return
  }
  if (sub === 'done') {
    const id = requireId(rest)
    const item = await doneWorkItem(store, new RunManager(projectRoot), id)
    emitSuccess(json, { item })
    return
  }
  if (sub === 'drop') {
    const id = requireId(rest)
    const item = await mutateWorkItem(store, id, (current) => dropWorkItem(current))
    emitSuccess(json, { item })
    return
  }
  if (sub === 'resume') {
    const parsed = parseResume(rest)
    const item = await mutateWorkItem(store, parsed.id, (current) =>
      resumeWorkItem(current, parsed.to),
    )
    emitSuccess(json, { item })
    return
  }
  usageWorkitem(`unknown workitem subcommand: ${sub}`)
}

/**
 * WorkItem gate list|approve|reject for WI- ids.
 */
export async function cmdWorkItemGate(
  sub: 'list' | 'approve' | 'reject',
  id: string,
  json: boolean,
  projectRoot: string,
): Promise<void> {
  if (!id.startsWith('WI-')) {
    throw new WorkItemCliError('invalid_gate_target', { id, exitCode: 2 })
  }
  const store = new WorkItemStore(projectRoot)
  if (sub === 'list') {
    const { item } = await store.read(id)
    if (json) emitJson({ id: item.id, status: item.status, gate: item.gate })
    else {
      process.stdout.write(
        `${item.id}\t${item.status}\tgate=${item.gate ? item.gate.trigger : 'null'}\n`,
      )
    }
    process.exitCode = 0
    return
  }

  const result = await store.withLock(async () => {
    const cur = await store.read(id)
    const item = cur.item
    if (item.status !== 'awaiting-gate' || !item.gate) {
      const last = item.gate_log[item.gate_log.length - 1]
      if (
        last &&
        ((sub === 'approve' && last.decision === 'approved') ||
          (sub === 'reject' && last.decision === 'rejected'))
      ) {
        return {
          id: item.id,
          status: item.status,
          decision: last.decision,
          no_op: true,
          ...(last.trigger === 'ambiguous-requirement'
            ? {
                next_action:
                  sub === 'approve'
                    ? `rolekit workitem start ${item.id} --task <revised-task>`
                    : `rolekit workitem resume ${item.id} --to executing`,
              }
            : {}),
        }
      }
      if (
        last &&
        ((sub === 'approve' && last.decision === 'rejected') ||
          (sub === 'reject' && last.decision === 'approved'))
      ) {
        throw new WorkItemCliError('gate_decision_conflict', { id })
      }
      throw new WorkItemCliError('no_pending_gate', { id })
    }
    try {
      const all = await store.listAll()
      const deps = item.depends_on.map((depId) => {
        const d = all.find((x) => x.id === depId)
        if (!d) throw new WorkItemCliError('dependency_not_found', { detail: depId })
        return { id: d.id, status: d.status }
      })
      const next =
        sub === 'approve'
          ? approveWorkItemGate(item, new Date().toISOString(), deps)
          : rejectWorkItemGate(item)
      await store.write(next, cur.revision)
      const wasQuestion = item.gate.trigger === 'ambiguous-requirement'
      return {
        id: next.id,
        status: next.status,
        decision: sub === 'approve' ? 'approved' : 'rejected',
        no_op: false,
        ...(wasQuestion
          ? {
              next_action:
                sub === 'approve'
                  ? `rolekit workitem start ${item.id} --task <revised-task>`
                  : `rolekit workitem resume ${item.id} --to executing`,
            }
          : {}),
      }
    } catch (error) {
      if (error instanceof InvalidTransition) {
        throw new WorkItemCliError('invalid_workitem', { id, detail: error.message })
      }
      throw error
    }
  })

  if (json) emitJson(result)
  else process.stdout.write(`${result.id}\t${result.status}\t${result.decision}\n`)
  process.exitCode = 0
}

async function doneWorkItem(store: WorkItemStore, rm: RunManager, id: string): Promise<WorkItem> {
  return store.withLock(async () => {
    const cur = await store.read(id)
    let item = cur.item
    const revision = cur.revision

    const recoveryCount = latestRecoveryRunsCount(item)
    if (recoveryCount !== undefined && recoveryCount > item.runs.length) {
      throw new WorkItemCliError('invalid_workitem', {
        id,
        detail: 'recovery_runs_count exceeds runs length',
      })
    }
    if (
      recoveryCount !== undefined &&
      recoveryCount === item.runs.length &&
      (item.status === 'executing' || item.status === 'verifying')
    ) {
      throw new WorkItemCliError('recovery_in_progress', { id })
    }

    if (item.status === 'executing') {
      const runInfos = []
      for (const runId of item.runs) {
        const st = await rm.status(runId)
        let status: Awaited<ReturnType<typeof rm.collect>>['status'] | undefined
        if (st.state === 'finished') {
          status = (await rm.collect(runId)).status
        }
        runInfos.push({ run_id: runId, state: st.state, status })
      }
      try {
        item = autoBridgeToVerifying(item, runInfos)
      } catch (error) {
        if (error instanceof InvalidTransition) {
          const awaiting = runInfos.find((r) => r.state === 'awaiting-gate')
          throw new WorkItemCliError('runs_incomplete', {
            id,
            detail: error.message,
            run_id: awaiting?.run_id,
          })
        }
        throw error
      }
    }

    if (item.status !== 'verifying') {
      throw new WorkItemCliError('invalid_transition', {
        id,
        detail: `done from ${item.status}`,
      })
    }

    // goal deps
    const all = await store.listAll()
    const deps = item.depends_on.map((depId) => {
      const d = all.find((x) => x.id === depId)
      if (!d) throw new WorkItemCliError('dependency_not_found', { detail: depId })
      return { id: d.id, status: d.status }
    })

    const policy = await loadGatePolicy(store.projectRoot)
    const evaluation = evaluate([{ trigger: 'final-acceptance' }], policy)
    try {
      const next = applyProcessGateAction(
        item,
        'final-acceptance',
        evaluation.overall,
        new Date().toISOString(),
        deps,
      )
      await store.write(next, revision)
      return next
    } catch (error) {
      if (error instanceof InvalidTransition) {
        throw new WorkItemCliError('invalid_transition', { id, detail: error.message })
      }
      throw error
    }
  })
}

function parseCreate(args: string[]): {
  kind: WorkItem['kind']
  title: string
  depends_on: string[]
} {
  let kind: string | undefined
  let title: string | undefined
  const depends_on: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--kind') {
      kind = args[++i]
      continue
    }
    if (a === '--title') {
      title = args[++i]
      continue
    }
    if (a === '--depends-on') {
      const v = args[++i]
      if (!v) usageWorkitem('missing --depends-on value')
      depends_on.push(v!)
      continue
    }
    if (a.startsWith('-')) usageWorkitem(`unknown flag: ${a}`)
    usageWorkitem('unexpected argument')
  }
  if (!kind || !KINDS.has(kind)) usageWorkitem('usage: workitem create --kind <k> --title <t>')
  if (!title) usageWorkitem('missing --title')
  return { kind: kind as WorkItem['kind'], title, depends_on }
}

function parseList(args: string[]): { status?: string; kind?: string } {
  let status: string | undefined
  let kind: string | undefined
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--status') {
      status = args[++i]
      if (!status || !STATUSES.has(status)) usageWorkitem('invalid --status')
      continue
    }
    if (a === '--kind') {
      kind = args[++i]
      if (!kind || !KINDS.has(kind)) usageWorkitem('invalid --kind')
      continue
    }
    if (a.startsWith('-')) usageWorkitem(`unknown flag: ${a}`)
    usageWorkitem('unexpected argument')
  }
  return { status, kind }
}

function parseStart(args: string[]): {
  id: string
  taskPath?: string
  estimated_files: number
  cross_module: boolean
  migration: boolean
  context_already_loaded: boolean
  laneOverride?: Lane
} {
  let id: string | undefined
  let taskPath: string | undefined
  let estimated_files = 0
  let cross_module = false
  let migration = false
  let context_already_loaded = false
  let laneOverride: Lane | undefined
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--task') {
      taskPath = args[++i]
      if (!taskPath) usageWorkitem('missing --task')
      taskPath = resolve(taskPath!)
      continue
    }
    if (a === '--estimated-files') {
      estimated_files = Number.parseInt(args[++i] ?? '', 10)
      if (!Number.isFinite(estimated_files)) usageWorkitem('invalid --estimated-files')
      continue
    }
    if (a === '--cross-module') {
      cross_module = true
      continue
    }
    if (a === '--migration') {
      migration = true
      continue
    }
    if (a === '--context-loaded') {
      context_already_loaded = true
      continue
    }
    if (a === '--lane') {
      const v = args[++i]
      if (!v || !LANES.has(v)) usageWorkitem('invalid --lane')
      laneOverride = v as Lane
      continue
    }
    if (a.startsWith('-')) usageWorkitem(`unknown flag: ${a}`)
    if (id) usageWorkitem('unexpected argument')
    id = a
  }
  if (!id) usageWorkitem('usage: workitem start <id> [--task file]')
  return {
    id,
    taskPath,
    estimated_files,
    cross_module,
    migration,
    context_already_loaded,
    laneOverride,
  }
}

function parseResume(args: string[]): {
  id: string
  to: 'planned' | 'designing' | 'executing'
} {
  let id: string | undefined
  let to: 'planned' | 'designing' | 'executing' | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (arg === '--to') {
      const value = args[++index]
      if (value !== 'planned' && value !== 'designing' && value !== 'executing') {
        usageWorkitem('invalid --to')
      }
      to = value
      continue
    }
    if (arg.startsWith('-')) usageWorkitem(`unknown flag: ${arg}`)
    if (id) usageWorkitem('unexpected argument')
    id = arg
  }
  if (!id || !to) usageWorkitem('usage: workitem resume <id> --to <status>')
  return { id, to }
}

async function mutateWorkItem(
  store: WorkItemStore,
  id: string,
  mutation: (item: WorkItem) => WorkItem,
): Promise<WorkItem> {
  return store.withLock(async () => {
    const current = await store.read(id)
    try {
      const next = mutation(current.item)
      await store.write(next, current.revision)
      return next
    } catch (error) {
      if (error instanceof InvalidTransition) {
        throw new WorkItemCliError('invalid_transition', { id, detail: error.message })
      }
      throw error
    }
  })
}

function requireId(args: string[]): string {
  const id = args[0]
  if (!id || id.startsWith('-')) usageWorkitem('missing workitem id')
  for (const a of args.slice(1)) {
    if (a.startsWith('-')) usageWorkitem(`unknown flag: ${a}`)
    usageWorkitem('unexpected argument')
  }
  return id!
}

function parseNoExtra(args: string[]): void {
  if (args.length > 0) usageWorkitem('unexpected argument')
}

function usageWorkitem(message?: string): never {
  if (message) process.stderr.write(`${message}\n`)
  process.stderr.write(
    'usage: rolekit workitem create|list|next|design|start|done|drop|resume <...>\n',
  )
  process.exitCode = 2
  throw new WorkItemCliError('invalid_usage', { exitCode: 2, message: message ?? 'usage' })
}

function emitSuccess(
  json: boolean,
  payload: { item: WorkItem; run_id?: string; no_op?: boolean },
): void {
  if (json) emitJson(payload)
  else {
    process.stdout.write(`${payload.item.id}\t${payload.item.status}\n`)
  }
  process.exitCode = 0
}

function emitJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}
