/**
 * Superpowers 5.1.3 SourceAdapter (D11–D13).
 */

import { readSourceFile } from '../../safety.ts'
import type {
  DetectedSource,
  MapContext,
  MigrationDecisions,
  MigrationPlan,
  ProvenanceRecord,
  SourceAdapter,
  SourceEntity,
  SourceManifest,
} from '../../types.ts'
import { MigrationError } from '../../types.ts'
import { validateSuperpowersGate } from './gate.ts'
import {
  bundleSourceDigest,
  classifyPackageDiscard,
  isNoteSlug,
  isProfileSlug,
  mapSuperpowersEntities,
  type SuperpowersBundleFile,
  type SuperpowersSkillPayload,
} from './map.ts'
import { REQUIRED_SKILL_SLUGS, SUPERPOWERS_ADAPTER_ID } from './templates.ts'

export { SUPERPOWERS_ADAPTER_ID }

/**
 * RoleKit migrate adapter for obra Superpowers Codex plugin 5.1.3.
 */
export const superpowersAdapter: SourceAdapter = {
  from: 'superpowers',

  async detect(root: string): Promise<DetectedSource> {
    await validateSuperpowersGate(root)
    return {
      from: 'superpowers',
      adapter_id: SUPERPOWERS_ADAPTER_ID,
      root,
    }
  },

  async scan(root: string, manifest: SourceManifest) {
    await validateSuperpowersGate(root)
    if (manifest.adapter_id !== SUPERPOWERS_ADAPTER_ID) {
      throw new MigrationError('migration_source_version_unsupported', {
        detail: {
          code: 'migration_source_version_unsupported',
          message_code: 'migration_source_version_unsupported',
          refs: [`manifest.adapter_id:${manifest.adapter_id}`],
        },
      })
    }

    const provenance: ProvenanceRecord[] = []
    const discarded = collectPackageDiscards(manifest)
    const entities: SourceEntity[] = []

    for (const slug of REQUIRED_SKILL_SLUGS) {
      const prefix = `skills/${slug}/`
      const bundleManifestFiles = manifest.files.filter((f) => f.path.startsWith(prefix))
      const source_digest = bundleSourceDigest(slug, manifest.files)
      const files = await loadBundleFiles(root, slug, bundleManifestFiles)
      const payload: SuperpowersSkillPayload = { slug, files }
      const category = isProfileSlug(slug)
        ? 'superpowers-profile'
        : isNoteSlug(slug)
          ? 'superpowers-note'
          : null
      if (!category) {
        throw new MigrationError('migration_semantic_fidelity_failed', {
          detail: {
            code: 'migration_semantic_fidelity_failed',
            message_code: 'migration_semantic_fidelity_failed',
            refs: [`skills/${slug}`],
          },
        })
      }
      entities.push({
        category,
        source_key: slug,
        source_digest,
        payload,
      })
    }

    return { entities, provenance, discarded }
  },

  map(entities: SourceEntity[], decisions: MigrationDecisions, ctx: MapContext): MigrationPlan {
    if (ctx.adapter_id !== SUPERPOWERS_ADAPTER_ID) {
      throw new MigrationError('migration_source_version_unsupported', {
        detail: {
          code: 'migration_source_version_unsupported',
          message_code: 'migration_source_version_unsupported',
          refs: [`adapter_id:${ctx.adapter_id}`],
        },
      })
    }
    return mapSuperpowersEntities(entities, decisions, ctx)
  },
}

function collectPackageDiscards(manifest: SourceManifest) {
  const discarded = []
  for (const file of manifest.files) {
    if (!file.sha256) continue
    if (file.path.startsWith('skills/')) continue
    if (file.path === 'LICENSE') continue
    discarded.push({
      source_path: file.path,
      heading: null,
      source_sha256: file.sha256,
      reason: classifyPackageDiscard(file.path),
    })
  }
  discarded.sort((a, b) => a.source_path.localeCompare(b.source_path))
  return discarded
}

async function loadBundleFiles(
  root: string,
  _slug: string,
  manifestFiles: SourceManifest['files'],
): Promise<SuperpowersBundleFile[]> {
  const files: SuperpowersBundleFile[] = []
  const regular = manifestFiles
    .filter((f) => f.type === 'file' && f.sha256)
    .sort((a, b) => a.path.localeCompare(b.path))

  for (const entry of regular) {
    if (!entry.sha256) continue
    const isBinary = isBinaryPath(entry.path)
    if (isBinary) {
      files.push({
        path: entry.path,
        sha256: entry.sha256,
        text: null,
        isBinary: true,
      })
      continue
    }
    const buf = await readSourceFile(root, entry.path, { requireUtf8: true })
    files.push({
      path: entry.path,
      sha256: entry.sha256,
      text: buf.toString('utf8'),
      isBinary: false,
    })
  }
  return files
}

function isBinaryPath(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return /\.(svg|png|jpg|jpeg|gif|webp|ico|dot)$/i.test(base)
}

/**
 * Reads MIT license text for promotion into target migrations folder.
 */
export async function readSuperpowersLicense(root: string): Promise<string> {
  const gate = await validateSuperpowersGate(root)
  return gate.licenseText
}

/**
 * Exposes gate validation for tests and CLI preflight.
 */
export { validateSuperpowersGate } from './gate.ts'
