import type { GatePolicy } from '../schemas/gate-policy.ts'
import type { WorkItem } from '../schemas/work-item.ts'

/** Signals used by selectLane rule table (roadmap 4.9 / D7). */
export interface LaneSignals {
  estimated_files: number
  cross_module: boolean
  migration: boolean
  context_already_loaded: boolean
}

export type Lane = 'direct' | 'delegated' | 'coordinated'

export interface LaneDecision {
  lane: Lane
  reason: string
}

/**
 * Rule-table lane router. v1 intentionally ignores policy (D7).
 */
export function selectLane(
  _item: WorkItem,
  _policy: GatePolicy,
  signals: LaneSignals,
): LaneDecision {
  if (signals.migration || signals.cross_module) {
    const hit = signals.migration ? 'migration=true' : 'cross_module=true'
    return { lane: 'coordinated', reason: `${hit} -> coordinated` }
  }
  if (signals.estimated_files <= 3 && signals.context_already_loaded) {
    return {
      lane: 'direct',
      reason: 'estimated_files<=3 && context_already_loaded=true -> direct',
    }
  }
  return { lane: 'delegated', reason: 'default -> delegated' }
}
