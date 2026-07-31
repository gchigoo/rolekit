import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { validateArtifact } from '@rolekit/core'

export interface RunIntegrityResult {
  pass: boolean
  /** Stable, redacted diagnostics; entries never contain an absolute path. */
  errors: string[]
}

type JsonObject = Record<string, unknown>

const CORE_FILES = ['task.json', 'prompt.md', 'events.jsonl', 'result.json', 'verification.json']
const SHA256 = /^[0-9a-f]{64}$/
const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

/** Read-only integrity audit for a terminal RoleKit run. */
export async function auditRunIntegrity(runDir: string): Promise<RunIntegrityResult> {
  const errors = new Set<string>()
  const root = resolve(runDir)
  const json = async (name: string): Promise<unknown | undefined> => {
    try {
      return JSON.parse(await readFile(join(root, name), 'utf8')) as unknown
    } catch {
      errors.add(`json_invalid:${safeName(name)}`)
      return undefined
    }
  }

  for (const name of CORE_FILES) {
    try {
      const stat = await lstat(join(root, name))
      if (!stat.isFile() || stat.isSymbolicLink()) errors.add(`artifact_not_regular:${name}`)
    } catch {
      errors.add(`artifact_missing:${name}`)
    }
  }

  const task = await json('task.json')
  const result = await json('result.json')
  const verification = await json('verification.json')
  const state = await json('run-state.json')
  if (task !== undefined && !validateArtifact('rolekit/task-contract@1', task).valid) {
    errors.add('schema_invalid:task.json')
  }
  if (result !== undefined && !validateArtifact('rolekit/result-envelope@1', result).valid) {
    errors.add('schema_invalid:result.json')
  }
  if (!isObject(state)) errors.add('state_invalid:run-state.json')

  const runId = stringField(state, 'run_id')
  const taskId = stringField(task, 'id')
  if (runId === null || taskId === null) errors.add('identity_missing')
  if (taskId !== null && stringField(state, 'task_id') !== taskId) errors.add('task_id_mismatch')
  if (taskId !== null && stringField(result, 'task_id') !== taskId)
    errors.add('result_task_mismatch')
  if (!Number.isSafeInteger(field(state, 'attempt')) || Number(field(state, 'attempt')) < 1) {
    errors.add('attempt_invalid')
  }
  if (field(state, 'phase') !== 'terminal') errors.add('state_not_terminal')
  const status = stringField(result, 'status')
  if (
    status === null ||
    field(state, 'terminal_status') !== status ||
    field(state, 'state') !== 'finished'
  ) {
    errors.add('terminal_status_mismatch')
  }

  const events = await readEvents(root, errors)
  let previous = Number.NEGATIVE_INFINITY
  for (const event of events) {
    if (!validateArtifact('rolekit/run-event@1', event).valid) errors.add('event_schema_invalid')
    if (runId !== null && event.run_id !== runId) errors.add('event_run_mismatch')
    const time = typeof event.ts === 'string' ? Date.parse(event.ts) : Number.NaN
    if (!Number.isFinite(time)) errors.add('event_timestamp_invalid')
    else if (time < previous) errors.add('event_timestamp_decreased')
    previous = time
  }
  const started = events.filter((event) => event.type === 'started')
  const finished = events.filter((event) => event.type === 'finished')
  if (started.length > 1) errors.add('started_event_count')
  if (finished.length !== 1) errors.add('finished_event_count')
  if (
    finished.length === 1 &&
    isObject(finished[0]?.payload) &&
    finished[0].payload.status !== status
  ) {
    errors.add('finished_status_mismatch')
  }

  const executorControl = await optionalJson(root, 'artifacts/executor-control.json', errors)
  if (isObject(executorControl) && isObject(executorControl.started) && started.length !== 1) {
    errors.add('started_receipt_event_mismatch')
  }

  const verificationResults =
    isObject(verification) && Array.isArray(verification.results) ? verification.results : null
  if (verificationResults === null || !Array.isArray(field(verification, 'scope_violations'))) {
    errors.add('verification_invalid')
  } else {
    const verificationEvents = events.filter((event) => event.type === 'verification')
    const eventPairs = verificationEvents.map((event) =>
      isObject(event.payload)
        ? [event.payload.command, event.payload.exit_code]
        : [undefined, undefined],
    )
    const resultPairs = verificationResults.map((entry) =>
      isObject(entry) ? [entry.command, entry.exit_code] : [undefined, undefined],
    )
    if (JSON.stringify(eventPairs) !== JSON.stringify(resultPairs)) {
      errors.add('verification_event_mismatch')
    }
  }
  if (
    JSON.stringify(field(result, 'scope_violations')) !==
    JSON.stringify(field(verification, 'scope_violations'))
  ) {
    errors.add('scope_violations_mismatch')
  }

  const evidence = field(result, 'evidence')
  if (Array.isArray(evidence)) {
    for (const item of evidence) {
      if (typeof item !== 'string' || !(await containedRegularFile(root, item))) {
        errors.add('evidence_path_invalid')
      }
    }
  }

  const gates = await optionalJson(root, 'gates.json', errors)
  if (gates !== undefined && !validateArtifact('rolekit/gate-record@1', gates).valid) {
    errors.add('gate_schema_invalid')
  }

  await auditJsonSurfaces(root, errors)
  await auditSteering(root, state, events, errors)
  await auditIntegration(root, status, errors)
  return { pass: errors.size === 0, errors: [...errors].sort() }
}

async function readEvents(root: string, errors: Set<string>): Promise<JsonObject[]> {
  let text: string
  try {
    text = await readFile(join(root, 'events.jsonl'), 'utf8')
  } catch {
    return []
  }
  const events: JsonObject[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isObject(parsed)) throw new Error('not object')
      events.push(parsed)
    } catch {
      errors.add('jsonl_invalid:events.jsonl')
    }
  }
  return events
}

async function auditJsonSurfaces(root: string, errors: Set<string>): Promise<void> {
  for (const name of [
    'policy-snapshot.json',
    'profile-snapshot.json',
    'executor-profile-snapshot.json',
    'detect-snapshot.json',
    'knowledge-snapshot.json',
  ]) {
    await optionalJson(root, name, errors)
  }
  for (const dir of ['control', 'snapshots']) await parseJsonTree(root, dir, errors)
}

async function parseJsonTree(root: string, rel: string, errors: Set<string>): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`
    if (entry.isSymbolicLink()) {
      errors.add(`artifact_not_regular:${safeName(child)}`)
      continue
    }
    if (entry.isDirectory()) await parseJsonTree(root, child, errors)
    else if (entry.isFile() && entry.name.endsWith('.json')) await optionalJson(root, child, errors)
    else if (!entry.isFile()) errors.add(`artifact_not_regular:${safeName(child)}`)
  }
}

async function auditSteering(
  root: string,
  state: unknown,
  events: JsonObject[],
  errors: Set<string>,
): Promise<void> {
  let names: string[]
  try {
    names = await readdir(join(root, 'control', 'steer'))
  } catch {
    return
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue
    const value = await optionalJson(root, `control/steer/${name}`, errors)
    if (!isObject(value)) continue
    const id = name.slice(0, -5)
    const common =
      value.version === 1 &&
      value.request_id === id &&
      REQUEST_ID.test(id) &&
      typeof value.message === 'string' &&
      sha(value.message) === value.message_sha256 &&
      validIso(value.requested_at)
    const stateName = value.state
    const allowed =
      stateName === 'pending'
        ? [
            'dispatch',
            'message',
            'message_sha256',
            'request_id',
            'requested_at',
            'state',
            'version',
          ]
        : stateName === 'accepted'
          ? [
              'message',
              'message_sha256',
              'request_id',
              'requested_at',
              'resolved_at',
              'state',
              'version',
            ]
          : stateName === 'failed'
            ? [
                'error_code',
                'message',
                'message_sha256',
                'request_id',
                'requested_at',
                'resolved_at',
                'state',
                'version',
              ]
            : []
    if (!common || !exactKeys(value, allowed)) {
      errors.add('steering_control_invalid')
      continue
    }
    const marker = `[steer:accepted] request_id=${id} message_sha256=${value.message_sha256}`
    const matches = events.filter(
      (event) =>
        event.type === 'message' &&
        isObject(event.payload) &&
        event.payload.role === 'system' &&
        event.payload.text === marker,
    )
    if (stateName === 'pending') {
      if (
        !['queued', 'inflight'].includes(String(value.dispatch)) ||
        field(state, 'phase') !== 'active'
      )
        errors.add('steering_pending_invalid')
    } else if (!validIso(value.resolved_at)) errors.add('steering_resolved_at_invalid')
    if (stateName === 'accepted' && (matches.length !== 1 || matches[0]?.ts !== value.resolved_at))
      errors.add('steering_accepted_event_mismatch')
    if (
      stateName === 'failed' &&
      (matches.length !== 0 ||
        ![
          'run_not_steerable',
          'executor_lost',
          'steer_rejected',
          'steer_response_timeout',
        ].includes(String(value.error_code)))
    )
      errors.add('steering_failed_invalid')
  }
}

async function auditIntegration(
  root: string,
  status: string | null,
  errors: Set<string>,
): Promise<void> {
  const names = [
    'candidate.json',
    'integration.patch',
    'integration-plan.json',
    'integration-result.json',
  ]
  const present = await Promise.all(
    names.map(async (name) => {
      try {
        await lstat(join(root, 'artifacts', name))
        return true
      } catch {
        return false
      }
    }),
  )
  if (present.some(Boolean) && (!present[0] || !present[1]))
    errors.add('integration_artifact_incomplete')
  if (status === 'completed' && present[0] && !present[3]) errors.add('integration_receipt_missing')
}

async function optionalJson(
  root: string,
  rel: string,
  errors: Set<string>,
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(join(root, rel), 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      errors.add(`json_invalid:${safeName(rel)}`)
    return undefined
  }
}

async function containedRegularFile(root: string, item: string): Promise<boolean> {
  if (!item || isAbsolute(item) || item.split(/[\\/]/).includes('..')) return false
  const target = resolve(root, item)
  if (target !== root && !target.startsWith(`${root}${sep}`)) return false
  try {
    const [canonicalRoot, canonicalTarget, stat] = await Promise.all([
      realpath(root),
      realpath(target),
      lstat(target),
    ])
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      canonicalTarget.startsWith(`${canonicalRoot}${sep}`)
    )
  } catch {
    return false
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined
}
function stringField(value: unknown, key: string): string | null {
  const v = field(value, key)
  return typeof v === 'string' ? v : null
}
function exactKeys(value: JsonObject, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, i) => key === expected[i])
}
function validIso(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  )
}
function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
function safeName(path: string): string {
  return basename(path) || relative('.', path).replaceAll('\\', '/')
}
