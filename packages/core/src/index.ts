export {
  type CompilePromptOptions,
  compilePrompt,
  resolvePromptFragments,
} from './compile-prompt.ts'
export { compileTask } from './compile-task.ts'
export {
  ErrorCatalog,
  type ErrorCatalogEntry,
  type ErrorCode,
  errorCatalogEntry,
} from './error-catalog.ts'
export { RolekitError, SchemaValidationError } from './errors.ts'
export {
  evaluate,
  type GateAction,
  type PolicyDecision,
  type PolicyEvaluation,
  type TriggerHit,
} from './gate/policy-engine.ts'
export {
  filterKnowledge,
  type KnowledgeDocument,
  type KnowledgeQuery,
  type PromptRule,
  parseKnowledgeMarkdown,
  selectActiveRules,
  serializeKnowledgeDocument,
} from './knowledge/index.ts'
export { type SchemaRegistryEntry, schemaRegistry } from './schema-registry.ts'
export * from './schemas/index.ts'
export { isValidGlobish } from './schemas/shared.ts'
export type {
  IssueLayer,
  SemanticIssue,
  ValidationIssue,
  ValidationResult,
} from './types.ts'
export { validateArtifact } from './validate.ts'
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
  InvalidTransition,
  isLegalTransition,
  type Lane,
  type LaneDecision,
  type LaneSignals,
  latestRecoveryRunsCount,
  type ResumeTarget,
  type RunBridgeInfo,
  rejectWorkItemGate,
  resumeWorkItem,
  selectLane,
  type TransitionContext,
  transition,
  type WorkItemStatus,
} from './workitem/index.ts'
