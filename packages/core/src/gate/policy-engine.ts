import type { GatePolicy } from '../schemas/gate-policy.ts'
import type { GateAction } from '../schemas/shared.ts'

/** Trigger hit produced by detectors or WorkItem allowlist constructors. */
export interface TriggerHit {
  trigger: string
  paths?: string[]
  evidence?: string
}

/** Per-hit decision from PolicyEngine (includes ignore). */
export interface PolicyDecision {
  trigger: string
  action: GateAction
  reason: string
}

/** Full evaluation: per-hit decisions plus folded overall action. */
export interface PolicyEvaluation {
  decisions: PolicyDecision[]
  overall: GateAction
}

const ACTION_RANK: Record<GateAction, number> = {
  ignore: 0,
  observe: 1,
  confirm: 2,
  block: 3,
}

/**
 * Pure PolicyEngine: maps trigger hits + GatePolicy → per-hit decisions and overall.
 * No I/O. Caller owns ignore filtering / persistence.
 */
export function evaluate(hits: TriggerHit[], policy: GatePolicy): PolicyEvaluation {
  if (hits.length === 0) {
    return { decisions: [], overall: 'ignore' }
  }

  const decisions: PolicyDecision[] = hits.map((hit) => {
    const explicit = (policy.triggers as Record<string, GateAction | undefined>)[hit.trigger]
    if (explicit !== undefined) {
      return {
        trigger: hit.trigger,
        action: explicit,
        reason: `explicit:${hit.trigger}`,
      }
    }
    return {
      trigger: hit.trigger,
      action: policy.default_action,
      reason: 'fallback:default_action warning',
    }
  })

  let overall: GateAction = 'ignore'
  for (const decision of decisions) {
    if (ACTION_RANK[decision.action] > ACTION_RANK[overall]) {
      overall = decision.action
    }
  }
  return { decisions, overall }
}

export type { GateAction }
