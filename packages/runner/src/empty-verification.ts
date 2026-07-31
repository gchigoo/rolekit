import type { ResultEnvelope } from '@rolekit/core'

/** Fixed empty verification for pre-report cancel/timeout/non-completed reports. */
export const EMPTY_VERIFICATION: ResultEnvelope['verification'] = []
export const EMPTY_SCOPE: string[] = []

export function emptyVerificationArtifact(): {
  passed: false
  results: []
  scope_violations: []
} {
  return { passed: false, results: [], scope_violations: [] }
}
