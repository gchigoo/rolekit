/**
 * Minimal semver range check for patterns like ">=0.80 <0.90".
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed) {
    return false
  }
  const clauses = range.trim().split(/\s+/).filter(Boolean)
  return clauses.every((clause) => matchClause(parsed, clause))
}

function parseVersion(version: string): [number, number, number] | null {
  const cleaned = version.replace(/^v/, '').split('-')[0] ?? ''
  const parts = cleaned.split('.').map((p) => Number(p))
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) {
    return null
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function matchClause(version: [number, number, number], clause: string): boolean {
  const m = clause.match(/^(>=|>|<=|<|=)?(.+)$/)
  if (!m) {
    return false
  }
  const op = m[1] ?? '='
  const bound = parseVersion(m[2] ?? '')
  if (!bound) {
    return false
  }
  const cmp = compare(version, bound)
  switch (op) {
    case '>':
      return cmp > 0
    case '>=':
      return cmp >= 0
    case '<':
      return cmp < 0
    case '<=':
      return cmp <= 0
    default:
      return cmp === 0
  }
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) {
      return a[i]! - b[i]!
    }
  }
  return 0
}
