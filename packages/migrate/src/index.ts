/**
 * @rolekit/migrate public surface.
 */

export { codestableAdapter } from './adapters/codestable/index.ts'
export { superpowersAdapter } from './adapters/superpowers/index.ts'
export { type MigrateOptions, type MigrateSuccess, runMigration } from './api.ts'
export { canonicalize, serializeCanonicalJson, sha256Canonical, sha256Text } from './canonical.ts'
export { decisionsDigest, emptyDecisions, loadDecisions, parseDecisionsYaml } from './decisions.ts'
export {
  assignIds,
  captureApplyInstant,
  computeFingerprint,
  encodeKeyPart,
  knKey,
  rpKey,
  wiAggregateKey,
  wiRoadmapItemKey,
  wiRoadmapKey,
} from './keys.ts'
export { promoteMigration } from './promote.ts'
export { buildMandatoryCounts, writeMigrationBundle } from './report.ts'
export { assertPathOutsideSource, buildSourceManifest } from './safety.ts'
export { serializeMigratedRoleProfile, serializeMigratedWorkItem } from './serialize.ts'
export { mapLifecycleStatus } from './status.ts'
export type * from './types.ts'
export { MigrationError } from './types.ts'
