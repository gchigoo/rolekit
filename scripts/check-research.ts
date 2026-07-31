/**
 * check:research — four roadmap assertions for kind=research completed runs.
 * Usage: node scripts/check-research.ts [--json] <runDir>
 * Exit 0 pass, 1 fail. Non-completed → run_not_completed.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Resolve junctions so Windows short-path campaigns match import.meta.url. */
function realpathOrResolve(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

export interface AssertionResult {
  id: string
  ok: boolean
  detail: string
}

export interface CheckResearchResult {
  ok: boolean
  code?: string
  assertions: AssertionResult[]
}

const FOOTNOTE_REF = /\[\^(\d+)\]/g
const FOOTNOTE_DEF = /^\[\^(\d+)\]:\s*\[([^\]]*)\]\(([^)]+)\)\s*$/

/**
 * Runs the four research assertions against a run directory.
 */
export function checkResearch(runDir: string): CheckResearchResult {
  const abs = resolve(runDir)
  const resultPath = join(abs, 'result.json')
  if (!existsSync(resultPath)) {
    return {
      ok: false,
      code: 'run_not_completed',
      assertions: [{ id: 'precondition', ok: false, detail: 'result.json missing' }],
    }
  }
  let result: { status?: string; evidence?: string[] }
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
      status?: string
      evidence?: string[]
    }
  } catch {
    return {
      ok: false,
      code: 'run_not_completed',
      assertions: [{ id: 'precondition', ok: false, detail: 'result.json unreadable' }],
    }
  }
  if (result.status !== 'completed') {
    return {
      ok: false,
      code: 'run_not_completed',
      assertions: [
        {
          id: 'precondition',
          ok: false,
          detail: `status=${String(result.status)} (need completed)`,
        },
      ],
    }
  }

  const reportPath = join(abs, 'artifacts', 'report.md')
  const activityPath = join(abs, 'artifacts', 'activity.json')
  const evidence = Array.isArray(result.evidence) ? result.evidence.map(normalizeRel) : []

  const a1 = assertArtifactsAndEvidence(reportPath, activityPath, evidence)
  const reportText = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : ''
  const activity = loadActivity(activityPath)
  const a2 = assertInlineCitationsResolve(reportText)
  const a3 = assertIndexMatchesAnnotations(reportText, activity)
  const a4 = assertHasWebSearchCall(activity)

  const assertions = [a1, a2, a3, a4]
  return { ok: assertions.every((a) => a.ok), assertions }
}

function assertArtifactsAndEvidence(
  reportPath: string,
  activityPath: string,
  evidence: string[],
): AssertionResult {
  const id = 'artifacts_and_evidence'
  if (!existsSync(reportPath) || !existsSync(activityPath)) {
    return { id, ok: false, detail: 'report.md or activity.json missing under artifacts/' }
  }
  const expected = ['artifacts/report.md', 'artifacts/activity.json']
  const set = new Set(evidence)
  if (evidence.length !== 2) {
    return {
      id,
      ok: false,
      detail: `evidence must be exactly 2 relative paths, got ${evidence.length}: ${evidence.join(',')}`,
    }
  }
  for (const e of expected) {
    if (!set.has(e)) {
      return { id, ok: false, detail: `evidence missing or non-canonical path: need ${e}` }
    }
  }
  return { id, ok: true, detail: 'both artifacts present; evidence exact pair' }
}

function assertInlineCitationsResolve(reportText: string): AssertionResult {
  const id = 'inline_citations_resolve'
  const defs = parseFootnoteDefs(reportText)
  const body = reportText
    .split(/\r?\n/)
    .filter((line) => !FOOTNOTE_DEF.test(line.trim()))
    .join('\n')
  const refs = new Set<string>()
  for (const m of body.matchAll(FOOTNOTE_REF)) {
    const n = m[1]
    if (n) refs.add(n)
  }
  if (refs.size === 0) {
    return { id, ok: false, detail: 'no inline [^n] citations in report body' }
  }
  for (const n of refs) {
    const def = defs.get(n)
    if (!def?.url || !def.title) {
      return { id, ok: false, detail: `inline [^${n}] has no index entry with url+title` }
    }
  }
  return { id, ok: true, detail: `${refs.size} inline citations resolve` }
}

function assertIndexMatchesAnnotations(
  reportText: string,
  activity: Activity | null,
): AssertionResult {
  const id = 'index_matches_annotations'
  if (!activity) {
    return { id, ok: false, detail: 'activity.json missing/invalid' }
  }
  const defs = parseFootnoteDefs(reportText)
  const indexKeys = new Set(
    [...defs.values()].map((d) => citationKey(d.url, d.title)).filter(Boolean),
  )
  const annKeys = new Set(
    (activity.annotations ?? [])
      .filter((a) => a && a.type === 'url_citation')
      .map((a) => citationKey(String(a.url ?? ''), String(a.title ?? '')))
      .filter(Boolean),
  )
  if (indexKeys.size !== annKeys.size) {
    return {
      id,
      ok: false,
      detail: `index size ${indexKeys.size} != annotations size ${annKeys.size}`,
    }
  }
  for (const k of indexKeys) {
    if (!annKeys.has(k)) {
      return { id, ok: false, detail: `index entry not in annotations: ${k}` }
    }
  }
  return { id, ok: true, detail: 'index ↔ annotations 1:1' }
}

function assertHasWebSearchCall(activity: Activity | null): AssertionResult {
  const id = 'has_web_search_call'
  if (!activity) {
    return { id, ok: false, detail: 'activity.json missing/invalid' }
  }
  const calls = Array.isArray(activity.tool_calls) ? activity.tool_calls : []
  const okCall = calls.find(
    (c) =>
      c &&
      c.type === 'web_search_call' &&
      typeof c.id === 'string' &&
      c.id.length > 0 &&
      typeof c.status === 'string',
  )
  if (!okCall) {
    return {
      id,
      ok: false,
      detail: 'no tool_calls entry with type=web_search_call and required keys',
    }
  }
  return { id, ok: true, detail: '>=1 web_search_call with required keys' }
}

interface Activity {
  tool_calls?: Array<{ id?: string; type?: string; status?: string; query?: string }>
  annotations?: Array<{
    type?: string
    start_index?: number
    end_index?: number
    url?: string
    title?: string
  }>
}

function loadActivity(path: string): Activity | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Activity
  } catch {
    return null
  }
}

function parseFootnoteDefs(text: string): Map<string, { title: string; url: string }> {
  const map = new Map<string, { title: string; url: string }>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(FOOTNOTE_DEF)
    if (!m || !m[1] || !m[2] || !m[3]) continue
    map.set(m[1], { title: m[2], url: m[3] })
  }
  return map
}

function citationKey(url: string, title: string): string {
  return `${url}\0${title}`
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

function main(): void {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const positional = args.filter((a) => a !== '--json')
  const runDir = positional[0]
  if (!runDir) {
    process.stderr.write('Usage: node scripts/check-research.ts [--json] <runDir>\n')
    process.exit(2)
  }
  const result = checkResearch(runDir)
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (!result.ok) {
    const code = result.code ?? 'assertions_failed'
    process.stderr.write(`check:research failed (${code})\n`)
    for (const a of result.assertions) {
      process.stderr.write(`  [${a.ok ? 'ok' : 'FAIL'}] ${a.id}: ${a.detail}\n`)
    }
  } else {
    process.stdout.write('check:research passed\n')
  }
  process.exit(result.ok ? 0 : 1)
}

const entry = process.argv[1] ? realpathOrResolve(process.argv[1]) : ''
const self = realpathOrResolve(fileURLToPath(import.meta.url))
const isMain = Boolean(entry) && entry.toLowerCase() === self.toLowerCase()

if (isMain) {
  main()
}


