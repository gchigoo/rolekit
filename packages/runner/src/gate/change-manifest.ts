import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One normalized change-manifest entry (R/C expand to old_path + path). */
export interface ChangeManifestEntry {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'
  path: string
  old_path?: string
}

export interface ChangeManifest {
  schema: 'rolekit/change-manifest@1'
  entries: ChangeManifestEntry[]
}

/**
 * Builds immutable HEAD+untracked change-manifest for detectors.
 * Uses `git diff --name-status -z HEAD --` and untracked as A.
 */
export async function buildChangeManifest(worktreePath: string): Promise<ChangeManifest> {
  const { stdout: nameStatus } = await execFileAsync(
    'git',
    ['diff', '--name-status', '-z', 'HEAD', '--'],
    { cwd: worktreePath, encoding: 'buffer' },
  )
  const { stdout: untracked } = await execFileAsync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: worktreePath, encoding: 'buffer' },
  )

  const entries = parseNameStatusZ(nameStatus)
  const seen = new Set(entries.map((e) => `${e.status}\0${e.old_path ?? ''}\0${e.path}`))
  for (const path of parseZPaths(untracked)) {
    const key = `A\0\0${path}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ status: 'A', path })
  }

  entries.sort((a, b) => {
    const ap = a.path.localeCompare(b.path)
    if (ap !== 0) return ap
    return (a.old_path ?? '').localeCompare(b.old_path ?? '')
  })

  return { schema: 'rolekit/change-manifest@1', entries }
}

/**
 * Parses NUL-separated name-status output into entries.
 */
function parseNameStatusZ(buf: Buffer): ChangeManifestEntry[] {
  const parts = splitZ(buf)
  const entries: ChangeManifestEntry[] = []
  let i = 0
  while (i < parts.length) {
    const statusRaw = parts[i++]
    if (!statusRaw) break
    const statusCode = statusRaw[0] as ChangeManifestEntry['status']
    if (statusCode === 'R' || statusCode === 'C') {
      const oldPath = parts[i++] ?? ''
      const path = parts[i++] ?? ''
      if (path) {
        entries.push({
          status: statusCode,
          path: normalizePath(path),
          old_path: normalizePath(oldPath),
        })
      }
      continue
    }
    const path = parts[i++] ?? ''
    if (path) {
      entries.push({ status: statusCode, path: normalizePath(path) })
    }
  }
  return entries
}

function parseZPaths(buf: Buffer): string[] {
  return splitZ(buf).filter(Boolean).map(normalizePath)
}

function splitZ(buf: Buffer): string[] {
  if (buf.length === 0) return []
  const text = buf.toString('utf8')
  return text.split('\0').filter((part, index, arr) => !(index === arr.length - 1 && part === ''))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}
