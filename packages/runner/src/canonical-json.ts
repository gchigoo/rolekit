import { createHash } from 'node:crypto'

/**
 * RFC8785-style canonical JSON: object keys sorted, arrays preserve order, no whitespace.
 */
export function canonicalize(value: unknown): string {
  return encode(value)
}

/**
 * Lowercase SHA-256 of RFC8785 canonical JSON.
 */
export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')
}

/**
 * SHA-256 of utf8 bytes.
 */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * SHA-256 of raw bytes.
 */
export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function encode(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonical JSON rejects non-finite numbers')
    }
    if (Object.is(value, -0)) {
      return '0'
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => encode(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const parts = keys.map((key) => `${JSON.stringify(key)}:${encode(record[key])}`)
    return `{${parts.join(',')}}`
  }
  throw new TypeError(`canonical JSON rejects type ${typeof value}`)
}
