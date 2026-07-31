/**
 * Minimal glob matcher for scope patterns (supports *, **, ?).
 */
export function matchGlob(pattern: string, path: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/')
  const normalizedPath = path.replace(/\\/g, '/')
  const regex = globToRegExp(normalizedPattern)
  return regex.test(normalizedPath)
}

/**
 * Returns true if path matches any pattern.
 */
export function matchAny(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => matchGlob(pattern, path))
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        const next = pattern[i + 2]
        if (next === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    if ('\\.[]{}()+-^$|'.includes(char ?? '')) {
      source += `\\${char}`
      continue
    }
    source += char
  }
  source += '$'
  return new RegExp(source)
}
