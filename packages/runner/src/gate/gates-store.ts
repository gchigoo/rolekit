import { join } from 'node:path'
import {
  type GateRecord,
  type GateRecordFile,
  type PolicyDecision,
  type TriggerHit,
  validateArtifact,
} from '@rolekit/core'
import { readJsonIfExists, writeJsonAtomic } from '../fs-util.ts'

/**
 * Empty gates wrapper for terminal short-circuits.
 */
export function emptyGatesFile(): GateRecordFile {
  return { schema: 'rolekit/gate-record@1', records: [] }
}

/**
 * Builds a mechanical scope-violation block record.
 */
export function mechanicalScopeRecord(ts: string): GateRecord {
  return {
    trigger: 'scope-violation',
    action: 'block',
    decision: 'blocked',
    evidence: 'verification.json#/scope_violations',
    ts,
  }
}

/**
 * Maps PolicyEngine decisions (+ hits) to persistable GateRecords.
 * ignore decisions are omitted; overall=block cancels confirm resolutions.
 */
export function recordsFromEvaluation(
  decisions: PolicyDecision[],
  hits: TriggerHit[],
  overall: PolicyDecision['action'],
  ts: string,
): GateRecord[] {
  const records: GateRecord[] = []
  decisions.forEach((decision, index) => {
    if (decision.action === 'ignore') return
    const hit = hits[index]
    const hit_paths = hit?.paths
    const evidence = hit?.evidence
    if (decision.action === 'observe') {
      records.push({
        trigger: decision.trigger,
        action: 'observe',
        decision: 'auto-pass',
        ...(hit_paths ? { hit_paths } : {}),
        ...(evidence ? { evidence } : {}),
        ts,
      })
      return
    }
    if (decision.action === 'block') {
      records.push({
        trigger: decision.trigger,
        action: 'block',
        decision: 'blocked',
        ...(hit_paths ? { hit_paths } : {}),
        ...(evidence ? { evidence } : {}),
        ts,
      })
      return
    }
    // confirm
    const record: GateRecord = {
      trigger: decision.trigger,
      action: 'confirm',
      decision: 'human-required',
      ...(hit_paths ? { hit_paths } : {}),
      ...(evidence ? { evidence } : {}),
      ts,
    }
    if (overall === 'block') {
      record.resolution = {
        result: 'cancelled',
        by: 'system',
        reason: 'higher-priority-block',
        ts,
      }
    }
    records.push(record)
  })
  return records
}

/**
 * Writes validated gates.json atomically.
 */
export async function writeGatesFile(runDirectory: string, file: GateRecordFile): Promise<void> {
  const validation = validateArtifact('rolekit/gate-record@1', file)
  if (!validation.valid) {
    throw new Error(`invalid gates.json: ${JSON.stringify(validation.issues)}`)
  }
  await writeJsonAtomic(join(runDirectory, 'gates.json'), file)
}

/**
 * Reads gates.json if present.
 */
export async function readGatesFile(runDirectory: string): Promise<GateRecordFile | null> {
  return readJsonIfExists<GateRecordFile>(join(runDirectory, 'gates.json'))
}

/**
 * Pending confirm records (human-required without resolution).
 */
export function listPending(file: GateRecordFile): Array<{
  index: number
  trigger: string
  action: string
  evidence?: string
}> {
  const pending = []
  for (let i = 0; i < file.records.length; i += 1) {
    const record = file.records[i]!
    if (record.action === 'confirm' && record.decision === 'human-required' && !record.resolution) {
      pending.push({
        index: i,
        trigger: record.trigger,
        action: record.action,
        ...(record.evidence ? { evidence: record.evidence } : {}),
      })
    }
  }
  return pending
}
