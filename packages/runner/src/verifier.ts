import { exec, execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { TaskContract } from '@rolekit/core'
import { readJsonIfExists } from './fs-util.ts'
import { matchAny } from './glob.ts'
import type { BaselineSnapshot, VerificationReport } from './types.ts'
import { WorktreeManager } from './worktree.ts'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/** Options for MinimalVerifier.verify. */
export interface VerifyOptions {
  /**
   * When true, skip primary-tree baseline concurrent-change check.
   * Used by rolekit verify / reverify (D11): audit worktree only.
   */
  skipPrimaryConcurrent?: boolean
}

/**
 * Verifier seam — roadmap 4.6.
 */
export interface Verifier {
  verify(
    runDirectory: string,
    task: TaskContract,
    options?: VerifyOptions,
  ): Promise<VerificationReport>
}

/**
 * MinimalVerifier: acceptance exit codes + scope diff + primary baseline concurrent-change.
 */
export class MinimalVerifier implements Verifier {
  projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  async verify(
    runDirectory: string,
    task: TaskContract,
    options: VerifyOptions = {},
  ): Promise<VerificationReport> {
    const runState = await readJsonIfExists<{ worktree_path: string }>(
      join(runDirectory, 'run-state.json'),
    )
    const worktreePath = runState?.worktree_path
    if (!worktreePath) {
      return {
        passed: false,
        results: [],
        scope_violations: ['missing worktree_path'],
      }
    }

    const results: VerificationReport['results'] = []
    for (const cmd of task.acceptance.commands) {
      let exitCode = 0
      try {
        await execAsync(cmd.run, { cwd: worktreePath, windowsHide: true })
        exitCode = 0
      } catch (error) {
        const err = error as { code?: number }
        exitCode = typeof err.code === 'number' ? err.code : 1
      }
      results.push({ command: cmd.run, exit_code: exitCode })
    }

    const scope_violations = await this.collectScopeViolations(worktreePath, task)
    if (!options.skipPrimaryConcurrent) {
      const baseline = await readJsonIfExists<BaselineSnapshot>(join(runDirectory, 'baseline.json'))
      if (baseline) {
        const wt = new WorktreeManager(this.projectRoot)
        const concurrent = await wt.diffBaseline(baseline)
        for (const v of concurrent) {
          scope_violations.push(v)
        }
      }
    }

    const commandsOk = results.every(
      (r, i) => r.exit_code === task.acceptance.commands[i]?.expect_exit,
    )
    const passed = commandsOk && scope_violations.length === 0
    return { passed, results, scope_violations }
  }

  private async collectScopeViolations(
    worktreePath: string,
    task: TaskContract,
  ): Promise<string[]> {
    let stdout = ''
    try {
      const result = await execFileAsync('git', ['diff', '--name-only', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf8',
      })
      stdout = result.stdout
      const untracked = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: worktreePath,
        encoding: 'utf8',
      })
      stdout += `\n${untracked.stdout}`
    } catch {
      return ['failed to compute worktree diff']
    }
    const files = stdout
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\\/g, '/'))
      .filter(Boolean)
    const violations: string[] = []
    for (const file of files) {
      if (matchAny(task.scope.forbidden, file)) {
        violations.push(`forbidden:${file}`)
        continue
      }
      if (task.scope.writable.length > 0 && !matchAny(task.scope.writable, file)) {
        violations.push(`outside-writable:${file}`)
      }
    }
    return violations
  }
}
