/**
 * @rolekit/evals public surface — evaluateRun is the hardening shared seam.
 */

export type {
  CampaignBlocker,
  CampaignEvaluation,
  CampaignInput,
  CampaignSnapshot,
  DogfoodMetrics,
  DogfoodPlan,
  DogfoodPlanItem,
  LedgerGate,
  LedgerRun,
  LedgerWorkItem,
  LiveEvidence,
  ResearchCheck,
  SwitchDecision,
} from './campaign.ts'
export {
  CONFIRM_TRIGGERS,
  buildCampaignArtifacts,
  buildExpectedSteerMessage,
  buildSwitchDecision,
  canonical,
  evaluateCampaign,
  pathsQualifyPatch,
  renderSwitchDecisionMarkdown,
  scanRunContent,
  writeSwitchDecisionFiles,
} from './campaign.ts'
export { admitSeed, captureSeed, SEED_ARTIFACTS } from './capture.ts'
export { evaluateRun } from './evaluate.ts'
export type { RunIntegrityResult } from './integrity.ts'
export { auditRunIntegrity } from './integrity.ts'
export { evaluateLedger, parseSeedMeta } from './ledger.ts'
export { FORBIDDEN_SEED_PATTERNS, findForbiddenLeak, redactText } from './redact.ts'
export type {
  CountMetric,
  EvalsReport,
  RatioMetric,
  RunEvalMeta,
  RunEvalResult,
  SeedEvalRow,
  SeedExpectation,
  SeedMeta,
} from './types.ts'
