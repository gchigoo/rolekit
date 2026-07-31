/**
 * RFC8785-style canonical JSON + SHA-256 helpers for migrate digests.
 */

import { createHash } from 'node:crypto'

/**
 * Encodes a value as RFC8785-style canonical JSON (sorted object keys, no whitespace).
 */
export function canonicalize(value: unknown): string {
  return encode(value)
}

/**
 * Lowercase SHA-256 of RFC8785 canonical JSON UTF-8 bytes.
 */
export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')
}

/**
 * Lowercase SHA-256 of a UTF-8 string.
 */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Lowercase SHA-256 of raw bytes.
 */
export function sha256Buffer(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Serializes machine JSON envelopes: RFC8785 UTF-8, no BOM, no trailing newline.
 */
export function serializeCanonicalJson(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), 'utf8')
}

/**
 * UTF-8 byte-order compare for strings (used by assignIds / depends sorting).
 */
export function compareUtf8(a: string, b: string): number {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  const n = Math.min(ab.length, bb.length)
  for (let i = 0; i < n; i += 1) {
    if (ab[i]! !== bb[i]!) return ab[i]! - bb[i]!
  }
  return ab.length - bb.length
}

/**
 * Sorts a string array by UTF-8 byte order and deduplicates adjacent equals.
 */
export function sortUniqueUtf8(values: string[]): string[] {
  const sorted = [...values].sort(compareUtf8)
  const out: string[] = []
  for (const v of sorted) {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v)
  }
  return out
}

function encode(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonical JSON rejects non-finite numbers')
    }
    if (Object.is(value, -0)) return '0'
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
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
