import { join } from 'node:path'
import type { GateRecord, GateRecordFile } from '@rolekit/core'
import { appendEvent } from '../events.ts'
import { readTextIfExists } from '../fs-util.ts'

/**
 * Appends gate events for records that lack an events.jsonl entry with same evidence.
 */
export async function ensureGateEvents(
  runDirectory: string,
  runId: string,
  file: GateRecordFile,
): Promise<void> {
  for (let i = 0; i < file.records.length; i += 1) {
    const record = file.records[i]!
    const evidence = `gates.json#records/${i}`
    if (await hasGateEvidence(runDirectory, evidence)) {
      continue
    }
    await appendEvent(runDirectory, {
      run_id: runId,
      type: 'gate',
      payload: {
        gate: record.trigger,
        action: record.action,
        decision: record.decision,
        evidence,
      },
    })
  }
}

/**
 * Checks whether a gate event with exact evidence pointer already exists.
 */
export async function hasGateEvidence(runDirectory: string, evidence: string): Promise<boolean> {
  const text = await readTextIfExists(join(runDirectory, 'events.jsonl'))
  if (!text) return false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const evt = JSON.parse(line) as {
        type?: string
        payload?: { evidence?: string }
      }
      if (evt.type === 'gate' && evt.payload?.evidence === evidence) {
        return true
      }
    } catch {
      // skip
    }
  }
  return false
}

/**
 * Appends empty-api_paths warning once (dedupe by exact text).
 */
export async function ensureEmptyApiPathsWarning(
  runDirectory: string,
  runId: string,
  text: string,
): Promise<void> {
  const existing = await readTextIfExists(join(runDirectory, 'events.jsonl'))
  if (existing) {
    for (const line of existing.split('\n')) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line) as {
          type?: string
          payload?: { role?: string; text?: string }
        }
        if (evt.type === 'message' && evt.payload?.text === text) {
          return
        }
      } catch {
        // skip
      }
    }
  }
  await appendEvent(runDirectory, {
    run_id: runId,
    type: 'message',
    payload: { role: 'system', text },
  })
}

/**
 * Applies the same resolution to every pending confirm record.
 */
export function resolveAllPending(
  file: GateRecordFile,
  resolution: NonNullable<GateRecord['resolution']>,
): GateRecordFile {
  return {
    schema: 'rolekit/gate-record@1',
    records: file.records.map((record) => {
      if (
        record.action === 'confirm' &&
        record.decision === 'human-required' &&
        !record.resolution
      ) {
        return { ...record, resolution }
      }
      return record
    }),
  }
}
