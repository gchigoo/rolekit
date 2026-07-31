import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RolekitError, type ValidationResult, validateArtifact } from '@rolekit/core'
import { MigrationError } from '@rolekit/migrate'
import {
  ExecutorUnsupportedOperationError,
  loadRunInput,
  loadTask,
  RunManager,
  RunManagerError,
  UnknownAdapterError,
} from '@rolekit/runner'
import { cmdKnowledge, emitKnowledgeError } from './knowledge/commands.ts'
import { KnowledgeCliError } from './knowledge/errors.ts'
import { cmdMigrate, emitMigrateError } from './migrate.ts'
import { parseInputFile } from './parse-input.ts'
import { findProjectRootSafe } from './project.ts'
import { cmdWorkItem, cmdWorkItemGate } from './workitem/commands.ts'
import { WorkItemCliError } from './workitem/errors.ts'

/**
 * CLI entrypoint — thin shell over core/runner.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp(argv.includes('--json'))
    process.exitCode = 0
    return
  }

  const json = argv.includes('--json')
  const args = argv.filter((a) => a !== '--json')
  const command = args[0]

  try {
    if (command === 'validate') {
      await cmdValidate(args.slice(1), json)
      return
    }
    if (command === 'task') {
      await cmdTask(args.slice(1), json)
      return
    }
    if (command === 'run') {
      await cmdRun(args.slice(1), json)
      return
    }
    if (command === 'verify') {
      await cmdVerify(args.slice(1), json)
      return
    }
    if (command === 'gate') {
      await cmdGate(args.slice(1), json)
      return
    }
    if (command === 'workitem') {
      const projectRoot = await findProjectRootSafe(process.cwd())
      await cmdWorkItem(args.slice(1), json, projectRoot)
      return
    }
    if (command === 'knowledge') {
      const projectRoot = await findProjectRootSafe(process.cwd())
      await cmdKnowledge(args.slice(1), json, projectRoot)
      return
    }
    if (command === 'migrate') {
      await cmdMigrate(args.slice(1), json)
      return
    }
    usage(`unknown command: ${command}`)
  } catch (error) {
    handleError(error, json)
  }
}

async function cmdValidate(args: string[], json: boolean): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp(json)
    process.exitCode = 0
    return
  }
  const file = args.find((a) => !a.startsWith('-'))
  for (const a of args) {
    if (a.startsWith('-') && a !== '--json' && a !== '--help' && a !== '-h') {
      usage(`unknown flag: ${a}`)
      return
    }
  }
  if (!file) {
    usage('missing file argument')
    return
  }
  const input = parseInputFile(file)
  if (!input.ok) {
    if (json) {
      emitJson({ valid: false, code: input.code, message: input.message })
    } else {
      process.stderr.write(formatFailure(input.code, { message: input.message }))
    }
    process.exitCode = 1
    return
  }
  const result = validateArtifact(input.schema, input.data)
  if (result.valid) {
    if (json) emitJson({ valid: true, schema: input.schema })
    else process.stdout.write(`valid: ${input.schema}\n`)
    process.exitCode = 0
    return
  }
  const code = result.code ?? 'validation_error'
  if (json) emitJson({ valid: false, code, issues: result.issues })
  else process.stderr.write(formatFailure(code, result))
  process.exitCode = 1
}

async function cmdTask(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  if (sub !== 'create' && sub !== 'compile') {
    usage('usage: rolekit task create|compile <yaml> [--out file]')
    return
  }
  let file: string | undefined
  let out: string | undefined
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--out') {
      out = args[++i]
      continue
    }
    if (a.startsWith('-')) {
      usage(`unknown flag: ${a}`)
      return
    }
    if (file) {
      usage('unexpected extra argument')
      return
    }
    file = a
  }
  if (!file) {
    usage('missing yaml argument')
    return
  }
  const task = await loadTask(resolve(file))
  const text = `${JSON.stringify(task, null, 2)}\n`
  if (out) {
    writeFileSync(out, text, 'utf8')
  }
  if (json) {
    emitJson(task)
  } else if (!out) {
    process.stdout.write(text)
  } else {
    process.stdout.write(`${out}\n`)
  }
  process.exitCode = 0
}

async function cmdRun(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  if (!sub) {
    usage('usage: rolekit run start|status|steer|cancel|collect <...>')
    return
  }
  const projectRoot = await findProjectRootSafe(process.cwd())
  const rm = new RunManager(projectRoot)

  if (sub === 'start') {
    let taskPath: string | undefined
    let detach = false
    let retry = false
    for (let i = 1; i < args.length; i += 1) {
      const a = args[i]!
      if (a === '--detach') {
        detach = true
        continue
      }
      if (a === '--retry') {
        retry = true
        continue
      }
      if (a.startsWith('-')) {
        usage(`unknown flag: ${a}`)
        return
      }
      if (taskPath) {
        usage('unexpected extra argument')
        return
      }
      taskPath = a
    }
    if (!taskPath) {
      usage('missing task argument')
      return
    }
    const loaded = await loadRunInput(resolve(taskPath), { projectRoot })
    const handle = await rm.prepare({ ...loaded, retry })
    await rm.startPrepared(handle.run_id)
    if (!detach) {
      const settled = await rm.waitUntilSettled(handle.run_id)
      if (json) {
        emitJson({
          id: settled.id,
          state: settled.state,
          phase: settled.phase,
        })
      } else {
        process.stdout.write(`${settled.id}\t${settled.state}\t${settled.phase}\n`)
      }
      process.exitCode = settled.state === 'finished' ? 0 : 0
      return
    }
    const status = await rm.status(handle.run_id)
    if (json) emitJson({ id: status.id, state: status.state, phase: status.phase })
    else process.stdout.write(`${status.id}\n`)
    process.exitCode = 0
    return
  }

  const runId = args[1]
  if (!runId || runId.startsWith('-')) {
    usage(`usage: rolekit run ${sub} <run-id>`)
    return
  }
  if (sub === 'steer') {
    let message: string | undefined
    let requestId: string | undefined
    for (let i = 2; i < args.length; i += 1) {
      const arg = args[i]!
      if (arg === '--message') {
        message = args[++i]
        if (message === undefined) {
          usage('missing --message value')
          return
        }
        continue
      }
      if (arg === '--request-id') {
        requestId = args[++i]
        if (!requestId) {
          usage('missing --request-id value')
          return
        }
        continue
      }
      usage(arg.startsWith('-') ? `unknown flag: ${arg}` : 'unexpected extra argument')
      return
    }
    if (message === undefined) {
      usage('usage: rolekit run steer <run-id> --message <text> [--request-id <id>] [--json]')
      return
    }
    const result = await rm.steer(runId, message, requestId ? { requestId } : {})
    if (json) emitJson(result)
    else {
      process.stdout.write(
        `${result.id}\t${result.state}\t${result.steer.state}\t${result.steer.request_id}\n`,
      )
    }
    process.exitCode = 0
    return
  }

  for (const a of args.slice(2)) {
    if (a.startsWith('-')) {
      usage(`unknown flag: ${a}`)
      return
    }
    usage('unexpected extra argument')
    return
  }

  if (sub === 'status') {
    const status = await rm.status(runId)
    if (json) {
      emitJson({
        id: status.id,
        state: status.state,
        phase: status.phase,
        last_event_ts: status.last_event_ts,
        ...(status.terminal_status ? { terminal_status: status.terminal_status } : {}),
        ...(status.reason !== undefined ? { reason: status.reason } : {}),
      })
    } else {
      process.stdout.write(
        `${status.id}\t${status.state}\t${status.phase}\t${status.last_event_ts ?? ''}\n`,
      )
    }
    process.exitCode = 0
    return
  }

  if (sub === 'cancel') {
    const result = await rm.cancel(runId)
    if (json) emitJson({ id: result.id, state: result.state, no_op: result.no_op })
    else process.stdout.write(`${result.id}\t${result.state}\n`)
    process.exitCode = 0
    return
  }

  if (sub === 'collect') {
    const result = await rm.collect(runId)
    if (json) emitJson({ id: runId, state: 'finished', result })
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = 0
    return
  }

  usage(`unknown run subcommand: ${sub}`)
}

async function cmdVerify(args: string[], json: boolean): Promise<void> {
  const runId = args.find((a) => !a.startsWith('-'))
  for (const a of args) {
    if (a.startsWith('-') && a !== '--json') {
      usage(`unknown flag: ${a}`)
      return
    }
  }
  if (!runId) {
    usage('usage: rolekit verify <run-id>')
    return
  }
  const projectRoot = await findProjectRootSafe(process.cwd())
  const rm = new RunManager(projectRoot)
  const out = await rm.reverify(runId)
  if (json) emitJson({ id: runId, reverify: out.path })
  else process.stdout.write(`${out.path}\n`)
  process.exitCode = 0
}

async function cmdGate(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  if (sub !== 'list' && sub !== 'approve' && sub !== 'reject') {
    usage('usage: rolekit gate list|approve|reject <id> [--reason text] [--by who]')
    return
  }
  let id: string | undefined
  let reason: string | undefined
  let by: string | undefined
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--reason') {
      reason = args[++i]
      if (!reason) {
        usage('missing --reason value')
        return
      }
      continue
    }
    if (a === '--by') {
      by = args[++i]
      if (!by) {
        usage('missing --by value')
        return
      }
      continue
    }
    if (a.startsWith('-')) {
      usage(`unknown flag: ${a}`)
      return
    }
    if (id) {
      usage('unexpected extra argument')
      return
    }
    id = a
  }
  if (!id) {
    usage(`usage: rolekit gate ${sub} <id>`)
    return
  }

  if (id.startsWith('WI-')) {
    const projectRoot = await findProjectRootSafe(process.cwd())
    await cmdWorkItemGate(sub, id, json, projectRoot)
    return
  }
  if (!id.startsWith('run-')) {
    if (json) emitJson({ error: 'invalid_gate_target', id })
    else process.stderr.write(`invalid_gate_target: ${id}\n`)
    process.exitCode = 2
    return
  }

  const projectRoot = await findProjectRootSafe(process.cwd())
  const rm = new RunManager(projectRoot)
  if (sub === 'list') {
    const listed = await rm.listGates(id)
    if (json) emitJson(listed)
    else {
      process.stdout.write(
        `${listed.id}\t${listed.state}\t${listed.phase}\tpending=${listed.pending.length}\n`,
      )
    }
    process.exitCode = 0
    return
  }
  const result =
    sub === 'approve'
      ? await rm.approveGates(id, { reason, by })
      : await rm.rejectGates(id, { reason, by })
  if (json) emitJson(result)
  else process.stdout.write(`${result.id}\t${result.state}\t${result.decision}\n`)
  process.exitCode = 0
}

function handleError(error: unknown, json: boolean): void {
  if (error instanceof MigrationError) {
    emitMigrateError(error, json)
    return
  }
  if (error instanceof KnowledgeCliError) {
    emitKnowledgeError(error, json)
    return
  }
  if (error instanceof WorkItemCliError) {
    if (error.code === 'invalid_usage' && process.exitCode === 2) {
      return
    }
    if (json) {
      emitJson({
        error: error.code,
        ...(error.id ? { id: error.id } : {}),
        ...(error.detail ? { detail: error.detail } : {}),
        ...(error.run_id ? { run_id: error.run_id } : {}),
        ...(error.next_action ? { next_action: error.next_action } : {}),
      })
    } else {
      process.stderr.write(
        `${error.code}${error.detail ? `: ${error.detail}` : error.message !== error.code ? `: ${error.message}` : ''}\n`,
      )
    }
    process.exitCode = error.exitCode
    return
  }
  if (error instanceof ExecutorUnsupportedOperationError) {
    if (json) emitJson({ error: 'unsupported_operation' })
    else process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
    return
  }
  if (error instanceof UnknownAdapterError) {
    if (json) emitJson({ error: 'unknown_adapter', detail: error.message })
    else process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
    return
  }
  if (error instanceof RunManagerError || error instanceof RolekitError) {
    const code = error.code
    if (json) {
      emitJson({
        error: code,
        detail: error.message,
        ...(code === 'steer_wait_timeout' || code === 'executor_lost' ? { retryable: true } : {}),
        ...(looksLikeId(error.message) ? { id: error.message } : {}),
      })
    } else {
      process.stderr.write(`${code}: ${error.message}\n`)
    }
    process.exitCode = 1
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  if (json) emitJson({ error: 'internal_error', detail: message })
  else process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function looksLikeId(value: string): boolean {
  return value.startsWith('run-') || value.startsWith('WI-')
}

function usage(message: string): void {
  process.stderr.write(`${message}\n`)
  process.exitCode = 2
}

function printHelp(toJson: boolean): void {
  const text =
    'Usage:\n' +
    '  rolekit validate <file> [--json]\n' +
    '  rolekit task create|compile <yaml> [--out file] [--json]\n' +
    '  rolekit run start <task> [--detach] [--retry] [--json]\n' +
    '  rolekit run status|cancel|collect <run-id> [--json]\n' +
    '  rolekit run steer <run-id> --message <text> [--request-id <id>] [--json]\n' +
    '  rolekit verify <run-id> [--json]\n' +
    '  rolekit gate list|approve|reject <id> [--reason text] [--by who] [--json]\n' +
    '  rolekit workitem create|list|next|design|start|done <...> [--json]\n' +
    '  rolekit knowledge create|get|search|edit|set-status <...> [--json]\n' +
    '  rolekit migrate --from <codestable|superpowers> [--source <path>] [--target <project-root>]\n' +
    '                  [--decisions <yaml>] [--report-dir <path>] [--audit-only] [--json]\n' +
    '\nExit codes: 0 success, 1 business failure, 2 usage error.\n'
  if (toJson) emitJson({ help: text.trim() })
  else process.stdout.write(text)
}

function emitJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function formatFailure(
  code: string,
  result: Extract<ValidationResult, { valid: false }> | { message: string },
): string {
  if ('issues' in result) {
    const lines = result.issues.map((issue) => `  [${issue.layer}] ${issue.path}: ${issue.message}`)
    return `validation failed (${code})\n${lines.join('\n')}\n`
  }
  return `${code}: ${result.message}\n`
}

main()
