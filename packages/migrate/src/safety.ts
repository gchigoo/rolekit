/**
 * Source safety gate + SourceManifest builder (D3).
 */

import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { serializeCanonicalJson, sha256Buffer, sha256Canonical } from './canonical.ts'
import type { ManifestFile, SourceManifest } from './types.ts'
import { MigrationError } from './types.ts'

const MAX_FILE_BYTES = 8 * 1024 * 1024

/**
 * Builds a sorted SourceManifest for a source root without following symlinks.
 */
export async function buildSourceManifest(
  sourceRoot: string,
  adapterId: string,
): Promise<{ manifest: SourceManifest; digest: string }> {
  const rootReal = await safeRealpath(sourceRoot)
  const files: ManifestFile[] = []
  await walk(rootReal, rootReal, files)
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const manifest: SourceManifest = {
    version: 1,
    adapter_id: adapterId,
    files,
  }
  const digest = sha256Canonical(manifest)
  return { manifest, digest }
}

/**
 * Asserts output paths do not overlap the source root.
 */
export async function assertPathOutsideSource(
  sourceRoot: string,
  candidate: string,
  label: string,
): Promise<void> {
  let sourceReal: string
  let candReal: string
  try {
    sourceReal = await safeRealpath(sourceRoot)
    candReal = resolve(candidate)
    // candidate may not exist yet
    try {
      candReal = await safeRealpath(candidate)
    } catch {
      candReal = resolve(candidate)
    }
  } catch {
    throw new MigrationError('migration_source_not_found', {
      detail: {
        code: 'migration_source_not_found',
        message_code: 'migration_source_not_found',
        refs: [posixRel(sourceRoot)],
      },
    })
  }
  const src = normalizeSlash(sourceReal)
  const cand = normalizeSlash(candReal)
  if (cand === src || cand.startsWith(`${src}/`)) {
    throw new MigrationError('migration_path_overlap', {
      detail: {
        code: 'migration_path_overlap',
        message_code: 'migration_path_overlap',
        refs: [label, posixRel(candidate)],
      },
    })
  }
}

/**
 * Reads a regular file under source with size/UTF-8 checks for semantic text.
 */
export async function readSourceFile(
  sourceRoot: string,
  relPath: string,
  options: { requireUtf8?: boolean } = {},
): Promise<Buffer> {
  const abs = join(sourceRoot, ...relPath.split('/'))
  const st = await lstat(abs)
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new MigrationError('migration_source_unsafe', {
      detail: {
        code: 'migration_source_unsafe',
        message_code: 'migration_source_unsafe',
        refs: [relPath],
      },
    })
  }
  if (st.size > MAX_FILE_BYTES) {
    throw new MigrationError('migration_source_unsafe', {
      detail: {
        code: 'migration_source_unsafe',
        message_code: 'migration_source_unsafe',
        refs: [relPath, 'size'],
      },
    })
  }
  const rootReal = await safeRealpath(sourceRoot)
  const fileReal = await safeRealpath(abs)
  if (!normalizeSlash(fileReal).startsWith(`${normalizeSlash(rootReal)}/`)) {
    throw new MigrationError('migration_source_unsafe', {
      detail: {
        code: 'migration_source_unsafe',
        message_code: 'migration_source_unsafe',
        refs: [relPath, 'escape'],
      },
    })
  }
  const buf = await readFile(abs)
  if (options.requireUtf8 !== false) {
    assertUtf8(buf, relPath)
  }
  return buf
}

/**
 * Digests a SourceManifest object (RFC8785).
 */
export function manifestDigest(manifest: SourceManifest): string {
  return sha256Canonical(manifest)
}

/**
 * Serializes source-manifest.json bytes.
 */
export function serializeSourceManifest(manifest: SourceManifest): Buffer {
  return serializeCanonicalJson(manifest)
}

async function walk(rootReal: string, dir: string, out: ManifestFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const abs = join(dir, ent.name)
    const rel = toPosixRel(rootReal, abs)
    const st = await lstat(abs)
    if (st.isSymbolicLink()) {
      throw new MigrationError('migration_source_unsafe', {
        detail: {
          code: 'migration_source_unsafe',
          message_code: 'migration_source_unsafe',
          refs: [rel, 'symlink'],
        },
      })
    }
    if (st.isDirectory()) {
      out.push({ path: rel, type: 'directory', size: 0, sha256: null })
      await walk(rootReal, abs, out)
      continue
    }
    if (!st.isFile()) {
      throw new MigrationError('migration_source_unsafe', {
        detail: {
          code: 'migration_source_unsafe',
          message_code: 'migration_source_unsafe',
          refs: [rel, 'special'],
        },
      })
    }
    if (st.size > MAX_FILE_BYTES) {
      throw new MigrationError('migration_source_unsafe', {
        detail: {
          code: 'migration_source_unsafe',
          message_code: 'migration_source_unsafe',
          refs: [rel, 'size'],
        },
      })
    }
    const buf = await readFile(abs)
    out.push({
      path: rel,
      type: 'file',
      size: st.size,
      sha256: sha256Buffer(buf),
    })
  }
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await realpath(p)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new MigrationError('migration_source_not_found', {
        detail: {
          code: 'migration_source_not_found',
          message_code: 'migration_source_not_found',
          refs: [posixRel(p)],
        },
      })
    }
    throw error
  }
}

function toPosixRel(root: string, abs: string): string {
  const rel = relative(root, abs)
  return rel.split(sep).join('/')
}

function normalizeSlash(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function posixRel(p: string): string {
  return p.split(sep).join('/')
}

/**
 * Asserts buffer is valid UTF-8 (no replacement decode).
 */
function assertUtf8(buf: Buffer, rel: string): void {
  const text = buf.toString('utf8')
  if (Buffer.compare(Buffer.from(text, 'utf8'), buf) !== 0) {
    throw new MigrationError('migration_source_unsafe', {
      detail: {
        code: 'migration_source_unsafe',
        message_code: 'migration_source_unsafe',
        refs: [rel, 'utf8'],
      },
    })
  }
}

/**
 * SHA-256 hex of a file buffer.
 */
export function fileSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
