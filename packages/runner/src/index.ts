export type { ExecutorAdapter, ExecutorAdapterFactory } from './adapter.ts'
export { canonicalize, sha256Canonical } from './canonical-json.ts'
export {
  ExecutorIncompatibleError,
  ExecutorLostError,
  ExecutorStartError,
  ExecutorSteerRejectedError,
  ExecutorTimeoutError,
  ExecutorUnsupportedOperationError,
  RunManagerError,
  UnknownAdapterError,
} from './errors.ts'
export {
  closeBarrierSteering,
  commitExecutorReportForBarrier,
  commitExitBarrier,
  markExitBarrierReady,
  requestCancellingTransition,
  requestFinalizingTransition,
} from './exit-barrier.ts'
export { buildChangeManifest } from './gate/change-manifest.ts'
export { EMPTY_API_PATHS_WARNING, runDetectors } from './gate/detectors.ts'
export { runGateEvaluationPipeline } from './gate/gate-evaluation-pipeline.ts'
export { IntegrationManager } from './integration-manager.ts'
export { createStrictJsonlReader, serializeJsonLine } from './jsonl-framing.ts'
export {
  type KnowledgeSnapshot as LoaderKnowledgeSnapshot,
  knowledgeRulesForDigest,
  loadKnowledgeSnapshot,
} from './knowledge-loader.ts'
export {
  buildInputDigestObject,
  DEFAULT_DETECT_POLICY,
  DEFAULT_GATE_POLICY,
  type DetectPolicy,
  loadDetectPolicy,
  loadGatePolicy,
  loadRunInput,
  loadTask,
} from './loaders.ts'
export {
  captureProcessIdentity,
  commandSha256,
  isProcessIdentityLive,
  killProcessIdentityTree,
} from './process-identity.ts'
export { createAdapter, isRegisteredAdapter, listAdapters } from './registry.ts'
export { RunManager } from './run-manager.ts'
export { phaseToState } from './run-state-store.ts'
export {
  canonicalSteeringMessage,
  deriveSteeringRequestId,
  readSteeringControl,
  type SteeringControl,
  SteeringCoordinator,
} from './steering-coordinator.ts'
export type {
  BarrierResolution,
  ExitTransitionIntent,
  KnowledgeSnapshot,
  ManagedRunStatus,
  PrepareRunInput,
  ProbeResult,
  ProcessIdentity,
  RunContext,
  RunHandle,
  RunPhase,
  RunState,
  RunStatus,
  VerificationReport,
} from './types.ts'
export { MinimalVerifier, type VerifyOptions } from './verifier.ts'
export { WorktreeManager } from './worktree.ts'
