/**
 * WorkItem status mapping (D5 exact table) + aggregate stage resolution.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { StableErrorCode } from './types.ts'
import { MigrationError } from './types.ts'

const STATUS_MAP: Record<string, string> = {
  draft: 'planned',
  planned: 'planned',
  planning: 'planned',
  design: 'designing',
  designing: 'designing',
  'in-progress': 'executing',
  active: 'executing',
  implementing: 'executing',
  review: 'verifying',
  qa: 'verifying',
  verify: 'verifying',
  done: 'done',
  completed: 'done',
  accepted: 'done',
  dropped: 'dropped',
  cancelled: 'dropped',
  paused: 'blocked',
  blocked: 'blocked',
}

export type StageRank = 'accepted' | 'verify' | 'implementing' | 'design' | 'missing'

/**
 * Maps a frozen source lifecycle status string to WorkItem status.
 */
export function mapLifecycleStatus(raw: string | undefined | null): string {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw statusError('migration_status_missing')
  }
  const key = String(raw).trim()
  const mapped = STATUS_MAP[key]
  if (!mapped) {
    throw statusError('migration_status_unknown', key)
  }
  return mapped
}

/**
 * Resolves highest committed stage from aggregate directory direct children.
 */
export async function resolveAggregateStage(
  aggregateDir: string,
  sourceKey: string,
  kindPrefix: 'feature' | 'issue' | 'refactor' | 'goal',
): Promise<{ stage: StageRank; candidates: string[] }> {
  let names: string[]
  try {
    names = await readdir(aggregateDir)
  } catch {
    return { stage: 'missing', candidates: [] }
  }
  const candidates: string[] = []
  let best: StageRank = 'missing'
  for (const name of names) {
    if (!name.endsWith('.md') && !name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    const abs = join(aggregateDir, name)
    let text: string
    try {
      text = await readFile(abs, 'utf8')
    } catch {
      continue
    }
    const fm = parseFrontmatterLoose(text)
    if (!fm) continue
    const docType = typeof fm.doc_type === 'string' ? fm.doc_type : ''
    const entityField =
      (typeof fm.feature === 'string' && fm.feature) ||
      (typeof fm.issue === 'string' && fm.issue) ||
      (typeof fm.refactor === 'string' && fm.refactor) ||
      (typeof fm.goal === 'string' && fm.goal) ||
      ''
    // Entity key match when field present; checklist yaml may use feature field
    if (entityField && entityField !== sourceKey && !sourceKey.endsWith(entityField)) {
      // allow feature dir name containing date prefix vs field without — exact match required
      if (entityField !== sourceKey) continue
    }
    const status = typeof fm.status === 'string' ? fm.status : ''
    let stage: StageRank | null = null
    if (docType.endsWith('-acceptance') && (status === 'passed' || status === 'accepted')) {
      stage = 'accepted'
    } else if (
      (docType.endsWith('-qa') ||
        docType.endsWith('-code-review') ||
        docType.endsWith('-design-review')) &&
      status === 'passed'
    ) {
      stage = 'verify'
    } else if (docType.endsWith('-implementation') && status === 'completed') {
      stage = 'implementing'
    } else if (name.endsWith('-checklist.yaml') || name.endsWith('-checklist.yml')) {
      if (checklistAllDone(text)) stage = 'implementing'
    } else if (docType.endsWith('-design') || docType.endsWith('-report')) {
      stage = 'design'
    }
    if (stage) {
      candidates.push(`${name}:${stage}`)
      best = maxStage(best, stage)
    }
  }
  // Also accept checklist without doc_type if named *-checklist.yaml
  void kindPrefix
  return { stage: best, candidates }
}

/**
 * Maps aggregate stage rank to WorkItem status string.
 */
export function stageToStatus(stage: StageRank): string {
  switch (stage) {
    case 'accepted':
      return mapLifecycleStatus('accepted')
    case 'verify':
      return mapLifecycleStatus('verify')
    case 'implementing':
      return mapLifecycleStatus('implementing')
    case 'design':
      return mapLifecycleStatus('design')
    default:
      throw statusError('migration_status_missing')
  }
}

function maxStage(a: StageRank, b: StageRank): StageRank {
  const order: StageRank[] = ['missing', 'design', 'implementing', 'verify', 'accepted']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

function checklistAllDone(text: string): boolean {
  try {
    const doc = parseYaml(text) as {
      steps?: Array<{ status?: string }>
      checks?: Array<{ status?: string }>
    }
    const items = [...(doc.steps ?? []), ...(doc.checks ?? [])]
    if (items.length === 0) return false
    return items.every((i) => i.status === 'done')
  } catch {
    return false
  }
}

function parseFrontmatterLoose(text: string): Record<string, unknown> | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return null
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return null
  try {
    const fm = parseYaml(normalized.slice(4, end))
    if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
      return fm as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function statusError(code: StableErrorCode, ref?: string): MigrationError {
  return new MigrationError(code, {
    detail: {
      code,
      message_code: code,
      refs: ref ? [ref] : [],
    },
  })
}
