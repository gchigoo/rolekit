import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { sha256Buffer, sha256Text } from './canonical-json.ts'
import { RunManagerError } from './errors.ts'
import {
  ensureDir,
  readJsonIfExists,
  readTextIfExists,
  rmSafe,
  writeJsonAtomic,
} from './fs-util.ts'
import { withLock } from './lock.ts'
import type { BaselineSnapshot } from './types.ts'
import { WorktreeManager } from './worktree.ts'

const execFileAsync = promisify(execFile)

export interface CandidateRecord {
  patch_sha256: string
  change_manifest_sha256?: string
  worktree_digest: string
}

export interface IntegrationPlanEntry {
  path: string
  pre_digest: string | null
  post_digest: string | null
  mode: string
}

/**
 * Binary patch freeze + apply gate with backup rollback. Sole integration latch.
 */
export class IntegrationManager {
  projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  /**
   * Freezes verified worktree diff into integration.patch + candidate.json.
   */
  async freezeCandidate(
    runDirectory: string,
    worktreePath: string,
    verifierMode: 'minimal' | 'enhanced',
  ): Promise<CandidateRecord> {
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, encoding: 'utf8' })
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--binary', '--full-index', 'HEAD', '--'],
      { cwd: worktreePath, encoding: 'buffer' },
    )
    const patch = stdout
    const patchSha = sha256Buffer(patch)
    const worktreeDigest = sha256Buffer(patch)

    const manifestPath = join(runDirectory, 'artifacts', 'change-manifest.json')
    const manifest = await readJsonIfExists<object>(manifestPath)
    let change_manifest_sha256: string | undefined
    if (verifierMode === 'enhanced') {
      if (!manifest) {
        throw new RunManagerError('integration_failed', 'enhanced mode requires change-manifest')
      }
      change_manifest_sha256 = sha256Text(JSON.stringify(manifest))
    } else if (manifest) {
      throw new RunManagerError('integration_failed', 'minimal mode must not have change-manifest')
    }

    await ensureDir(join(runDirectory, 'artifacts'))
    await writeFile(join(runDirectory, 'artifacts', 'integration.patch'), patch)
    const candidate: CandidateRecord = {
      patch_sha256: patchSha,
      worktree_digest: worktreeDigest,
      ...(change_manifest_sha256 ? { change_manifest_sha256 } : {}),
    }
    await writeJsonAtomic(join(runDirectory, 'artifacts', 'candidate.json'), candidate)
    return candidate
  }

  /**
   * Applies frozen candidate to primary tree under integration.lock.
   * No git commit/merge — leaves unstaged/staged working tree changes only via apply.
   */
  async integrate(runDirectory: string, baseline: BaselineSnapshot): Promise<void> {
    const lockPath = join(this.projectRoot, '.rolekit', 'integration.lock')
    await withLock(lockPath, async () => {
      const candidate = await readJsonIfExists<CandidateRecord>(
        join(runDirectory, 'artifacts', 'candidate.json'),
      )
      const patch = await readTextIfExists(join(runDirectory, 'artifacts', 'integration.patch'))
      if (!candidate || patch === null) {
        throw new RunManagerError('integration_failed', 'missing candidate/patch')
      }

      // 重做临时 patch digest 与 candidate 比对
      const state = await readJsonIfExists<{ worktree_path: string }>(
        join(runDirectory, 'run-state.json'),
      )
      if (!state?.worktree_path) {
        throw new RunManagerError('integration_failed', 'missing worktree')
      }
      await execFileAsync('git', ['add', '-A'], {
        cwd: state.worktree_path,
        encoding: 'utf8',
      })
      const { stdout: livePatch } = await execFileAsync(
        'git',
        ['diff', '--cached', '--binary', '--full-index', 'HEAD', '--'],
        { cwd: state.worktree_path, encoding: 'buffer' },
      )
      if (sha256Buffer(livePatch) !== candidate.worktree_digest) {
        throw new RunManagerError(
          'worktree_changed_after_verification',
          'worktree changed after verification',
        )
      }

      const wt = new WorktreeManager(this.projectRoot)
      const concurrent = await wt.diffBaseline(baseline)
      if (concurrent.length > 0) {
        throw new RunManagerError('integration_failed', `检测到并发变更: ${concurrent.join('; ')}`)
      }

      // research 等无工作树变更：空 patch 直接成功（git apply 拒空输入）
      if (patch.trim().length === 0) {
        await writeJsonAtomic(join(runDirectory, 'artifacts', 'integration-plan.json'), {
          entries: [],
        })
        await writeJsonAtomic(join(runDirectory, 'artifacts', 'integration-result.json'), {
          status: 'applied',
          post_digest: sha256Text('[]'),
        })
        return
      }

      const plan = await this.buildPlan(patch)
      await writeJsonAtomic(join(runDirectory, 'artifacts', 'integration-plan.json'), {
        entries: plan,
      })
      const backupDir = join(runDirectory, 'artifacts', 'integration-backup')
      await this.writeBackup(backupDir, plan)

      try {
        await applyPatch(this.projectRoot, patch, true)
        await applyPatch(this.projectRoot, patch, false)
      } catch (error) {
        await this.restoreBackup(backupDir, plan)
        throw new RunManagerError(
          'integration_failed',
          error instanceof Error ? error.message : 'git apply failed',
        )
      }

      const withPost = await this.fillPostDigests(plan)
      const postOk = await this.verifyPost(withPost)
      if (!postOk) {
        await this.restoreBackup(backupDir, plan)
        throw new RunManagerError('integration_failed', 'post digest mismatch')
      }

      await writeJsonAtomic(join(runDirectory, 'artifacts', 'integration-plan.json'), {
        entries: withPost,
      })
      await writeJsonAtomic(join(runDirectory, 'artifacts', 'integration-result.json'), {
        status: 'applied',
        post_digest: sha256Text(JSON.stringify(withPost)),
      })
      await rmSafe(backupDir)
    })
  }

  private async buildPlan(patch: string): Promise<IntegrationPlanEntry[]> {
    const paths = new Set<string>()
    for (const line of patch.split('\n')) {
      if (line.startsWith('diff --git ')) {
        const m = line.match(/b\/(.+)$/)
        if (m?.[1]) {
          paths.add(m[1])
        }
      }
    }
    const entries: IntegrationPlanEntry[] = []
    for (const path of [...paths].sort()) {
      const abs = join(this.projectRoot, path)
      let pre: string | null = null
      try {
        pre = sha256Buffer(await readFile(abs))
      } catch {
        pre = null
      }
      entries.push({
        path,
        pre_digest: pre,
        post_digest: null,
        mode: '100644',
      })
    }
    return entries
  }

  /**
   * Fills per-path post_digest from primary tree bytes after apply.
   */
  private async fillPostDigests(plan: IntegrationPlanEntry[]): Promise<IntegrationPlanEntry[]> {
    const out: IntegrationPlanEntry[] = []
    for (const entry of plan) {
      const abs = join(this.projectRoot, entry.path)
      let post: string | null = null
      try {
        post = sha256Buffer(await readFile(abs))
      } catch {
        post = null
      }
      out.push({ ...entry, post_digest: post })
    }
    return out
  }

  private async writeBackup(backupDir: string, plan: IntegrationPlanEntry[]): Promise<void> {
    await ensureDir(backupDir)
    for (const entry of plan) {
      const abs = join(this.projectRoot, entry.path)
      try {
        const buf = await readFile(abs)
        const dest = join(backupDir, entry.path)
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, buf)
      } catch {
        // file absent pre-apply
      }
    }
    await writeJsonAtomic(join(backupDir, 'plan.json'), plan)
  }

  private async restoreBackup(backupDir: string, plan: IntegrationPlanEntry[]): Promise<void> {
    for (const entry of plan) {
      const abs = join(this.projectRoot, entry.path)
      const bak = join(backupDir, entry.path)
      try {
        const buf = await readFile(bak)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, buf)
      } catch {
        await rmSafe(abs)
      }
    }
  }

  private async verifyPost(plan: IntegrationPlanEntry[]): Promise<boolean> {
    for (const entry of plan) {
      const abs = join(this.projectRoot, entry.path)
      let actual: string | null = null
      try {
        actual = sha256Buffer(await readFile(abs))
      } catch {
        actual = null
      }
      if (actual !== entry.post_digest) {
        return false
      }
    }
    return true
  }
}

async function applyPatch(cwd: string, patch: string, checkOnly: boolean): Promise<void> {
  const { spawn } = await import('node:child_process')
  const args = checkOnly ? ['apply', '--check', '--binary'] : ['apply', '--binary']
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let err = ''
    proc.stderr.on('data', (c: Buffer) => {
      err += c.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(err || `git apply exited ${code}`))
      }
    })
    proc.stdin.write(patch)
    proc.stdin.end()
  })
}
