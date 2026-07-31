/**
 * Mechanical redaction for seed capture — absolute paths, keys, username patterns.
 */

/** Patterns that must not appear in committed seeds (self-check). */
export const FORBIDDEN_SEED_PATTERNS: RegExp[] = [
  /[A-Za-z]:\\/,
  /\/Users\//,
  /\/home\//,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /OPENAI_API_KEY\s*[:=]\s*(?!<redacted-key>)\S+/i,
  /api[_-]?key\s*[:=]\s*['"]?(?!<redacted-key>)[A-Za-z0-9_-]{16,}/i,
  /steven\.guo/i,
]

/**
 * Returns first forbidden pattern match in text, or null when clean.
 */
export function findForbiddenLeak(text: string): string | null {
  for (const pattern of FORBIDDEN_SEED_PATTERNS) {
    const m = text.match(pattern)
    if (m) return m[0]
  }
  return null
}

/**
 * Redacts absolute paths, API keys, and username-bearing path segments.
 */
export function redactText(text: string): string {
  let out = text
  // Windows absolute paths → keep trailing .rolekit/... when present, else placeholder
  out = out.replace(/[A-Za-z]:\\(?:[^\\/"'\s]+\\)*[^\\/"'\s]*/g, (match) => {
    const idx = match.toLowerCase().indexOf('.rolekit\\')
    if (idx >= 0) {
      return match.slice(idx).replace(/\\/g, '/')
    }
    const idx2 = match.toLowerCase().indexOf('.rolekit/')
    if (idx2 >= 0) {
      return match.slice(idx2)
    }
    return '<redacted-abs-path>'
  })
  // Unix absolute paths under Users/home/tmp/var/folders
  out = out.replace(/(?:\/(?:Users|home)\/[^\s"']+|\/(?:tmp|var\/folders)\/[^\s"']+)/g, (match) => {
    const idx = match.indexOf('.rolekit/')
    if (idx >= 0) return match.slice(idx)
    return '<redacted-abs-path>'
  })
  out = out.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, '<redacted-key>')
  out = out.replace(/(OPENAI_API_KEY|API_KEY|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=<redacted-key>')
  out = out.replace(/steven\.guo/gi, '<redacted-user>')
  return out
}
