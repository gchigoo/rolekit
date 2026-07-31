import { join } from 'node:path'
import type { ResultEnvelope, RunEvent } from '@rolekit/core'
import { appendJsonl, readTextIfExists } from './fs-util.ts'

/**
 * Appends a validated-shape run event.
 */
export async function appendEvent(
  runDirectory: string,
  event: Omit<RunEvent, 'schema' | 'ts'> & { ts?: string },
): Promise<void> {
  const full = {
    schema: 'rolekit/run-event@1' as const,
    ts: event.ts ?? new Date().toISOString(),
    ...event,
  }
  await appendJsonl(join(runDirectory, 'events.jsonl'), full)
}

/**
 * Ensures a single finished event for run_id+status (dedupe scan).
 */
export async function ensureFinishedEvent(
  runDirectory: string,
  runId: string,
  status: ResultEnvelope['status'],
  reason: string | null,
): Promise<void> {
  const text = await readTextIfExists(join(runDirectory, 'events.jsonl'))
  if (text) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line) as RunEvent
        if (evt.type === 'finished' && evt.run_id === runId && evt.payload.status === status) {
          return
        }
      } catch {
        // skip
      }
    }
  }
  await appendEvent(runDirectory, {
    run_id: runId,
    type: 'finished',
    payload: { status, reason },
  })
}

/**
 * Scans events for a gate dedupe key marker in evidence.
 */
export async function hasDedupeKey(runDirectory: string, dedupeKey: string): Promise<boolean> {
  const text = await readTextIfExists(join(runDirectory, 'events.jsonl'))
  if (!text) return false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const evt = JSON.parse(line) as RunEvent
      if (evt.type === 'gate' && evt.payload.evidence.includes(`dedupe:${dedupeKey}`)) {
        return true
      }
    } catch {
      // skip
    }
  }
  return false
}
