/**
 * Discover *.test.ts files and run them with node --test (Windows-safe).
 */

import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Recursively collects files ending with .test.ts.
 */
function collectTests(dir: string, acc: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectTests(full, acc)
    } else if (name.endsWith('.test.ts')) {
      acc.push(full)
    }
  }
  return acc
}

const roots = [
  join(root, 'packages/core/test'),
  join(root, 'packages/cli/test'),
  join(root, 'packages/runner/test'),
  join(root, 'packages/evals/test'),
  join(root, 'packages/migrate/test'),
  join(root, 'test/e2e'),
  join(root, 'test/adapters'),
]

const files = roots.flatMap((dir) => collectTests(dir)).sort()
if (files.length === 0) {
  process.stderr.write('No test files found\n')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

process.exit(result.status ?? 1)
