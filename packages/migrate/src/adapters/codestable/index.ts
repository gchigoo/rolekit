/**
 * CodeStable SourceAdapter export (`codestable@1`).
 */

import { decisionsDigest, emptyDecisions } from '../../decisions.ts'
import type {
  DetectedSource,
  MapContext,
  MigrationDecisions,
  MigrationPlan,
  SourceAdapter,
  SourceEntity,
  SourceManifest,
} from '../../types.ts'
import { codestableMandatoryCounts, mapCodestable } from './map.ts'
import {
  CODESTABLE_ADAPTER_ID,
  countEntitiesByCategory,
  detectCodestable,
  resolveCodestableRootForAdapter,
  scanCodestable,
} from './scan.ts'

export { attentionFileDigest, parseAttentionRules } from './attention.ts'
export {
  CODESTABLE_ADAPTER_ID,
  codestableMandatoryCounts,
  countEntitiesByCategory,
  detectCodestable,
  mapCodestable,
  resolveCodestableRootForAdapter,
  scanCodestable,
}

/**
 * RoleKit migrate adapter for local CodeStable trees.
 */
export const codestableAdapter: SourceAdapter = {
  from: 'codestable',

  async detect(root: string): Promise<DetectedSource> {
    return detectCodestable(root)
  },

  async scan(root: string, manifest: SourceManifest) {
    return scanCodestable(root, manifest)
  },

  map(entities: SourceEntity[], decisions: MigrationDecisions, ctx: MapContext): MigrationPlan {
    return mapCodestable(entities, decisions, ctx)
  },
}

/**
 * Builds MapContext with empty decisions digest when omitted.
 */
export function buildMapContext(input: {
  source_root: string
  manifest: SourceManifest
  source_manifest_sha256: string
  decisions?: MigrationDecisions
  provenance: MapContext['provenance']
  discarded: MapContext['discarded']
}): MapContext {
  const decisions = input.decisions ?? emptyDecisions()
  return {
    adapter_id: CODESTABLE_ADAPTER_ID,
    source_manifest_sha256: input.source_manifest_sha256,
    decisions_sha256: decisionsDigest(decisions),
    source_root: input.source_root,
    manifest: input.manifest,
    provenance: input.provenance,
    discarded: input.discarded,
  }
}
