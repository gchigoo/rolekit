export { InvalidTransition } from './errors.ts'
export { type Lane, type LaneDecision, type LaneSignals, selectLane } from './select-lane.ts'
export {
  type AdoptResult,
  adoptRunResult,
  allStatuses,
  applyProcessGateAction,
  applyQuestionGateAction,
  approveWorkItemGate,
  attachRun,
  autoBridgeToVerifying,
  dropWorkItem,
  type GateOrigin,
  hasResolvedDesignArtifact,
  isLegalTransition,
  latestRecoveryRunsCount,
  type ResumeTarget,
  type RunBridgeInfo,
  rejectWorkItemGate,
  resumeWorkItem,
  type TransitionContext,
  transition,
  type WorkItemStatus,
} from './state-machine.ts'
