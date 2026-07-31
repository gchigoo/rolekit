import type { ExecutorReport } from '@rolekit/core'
import { evaluate, type GatePolicy, type PolicyEvaluation, type TriggerHit } from '@rolekit/core'
import type { VerificationReport } from '../types.ts'
import type { ChangeManifest } from './change-manifest.ts'
import type { DetectPolicy } from './detect-policy.ts'
import { runDetectors, shouldWarnEmptyApiPaths } from './detectors.ts'

/** Branch plan returned by GateEvaluationPipeline (no persistence). */
export type GateBranch =
  | { kind: 'mechanical-scope-block' }
  | { kind: 'verification-failed' }
  | { kind: 'integrate'; evaluation: PolicyEvaluation; hits: TriggerHit[] }
  | { kind: 'awaiting-confirm'; evaluation: PolicyEvaluation; hits: TriggerHit[] }
  | { kind: 'blocked'; evaluation: PolicyEvaluation; hits: TriggerHit[] }

export interface PipelineInput {
  verification: VerificationReport
  executorReport: ExecutorReport
  policy: GatePolicy
  detect: DetectPolicy | null
  manifest: ChangeManifest | null
  verifierMode: 'minimal' | 'enhanced'
}

export interface PipelineResult {
  branch: GateBranch
  hits: TriggerHit[]
  evaluation: PolicyEvaluation | null
  warnEmptyApiPaths: boolean
}

/**
 * Pure-ish composite: detectors + PolicyEngine → branch plan.
 * No run artifact writes / state transitions.
 */
export function runGateEvaluationPipeline(input: PipelineInput): PipelineResult {
  if (!input.verification.passed) {
    if (input.verification.scope_violations.length > 0) {
      return {
        branch: { kind: 'mechanical-scope-block' },
        hits: [],
        evaluation: null,
        warnEmptyApiPaths: false,
      }
    }
    return {
      branch: { kind: 'verification-failed' },
      hits: [],
      evaluation: null,
      warnEmptyApiPaths: false,
    }
  }

  if (input.verifierMode === 'minimal' || !input.detect || !input.manifest) {
    const evaluation = evaluate([], input.policy)
    return {
      branch: { kind: 'integrate', evaluation, hits: [] },
      hits: [],
      evaluation,
      warnEmptyApiPaths: false,
    }
  }

  const warnEmptyApiPaths = shouldWarnEmptyApiPaths(input.detect)
  const hits = runDetectors({
    manifest: input.manifest,
    verification: input.verification,
    executorReport: input.executorReport,
    detect: input.detect,
  })
  const evaluation = evaluate(hits, input.policy)
  if (evaluation.overall === 'block') {
    return {
      branch: { kind: 'blocked', evaluation, hits },
      hits,
      evaluation,
      warnEmptyApiPaths,
    }
  }
  if (evaluation.overall === 'confirm') {
    return {
      branch: { kind: 'awaiting-confirm', evaluation, hits },
      hits,
      evaluation,
      warnEmptyApiPaths,
    }
  }
  return {
    branch: { kind: 'integrate', evaluation, hits },
    hits,
    evaluation,
    warnEmptyApiPaths,
  }
}
