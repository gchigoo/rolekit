import { canonicalJson } from './json.ts'
import type { Sha256Digest } from './types.ts'

export async function digestJson(value: unknown, label = 'Digest value'): Promise<Sha256Digest> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) {
    throw new Error('SHA-256 requires globalThis.crypto.subtle.')
  }
  const bytes = new TextEncoder().encode(canonicalJson(value, label))
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
  const hexadecimal = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hexadecimal}`
}
