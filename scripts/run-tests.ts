import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

async function collectTests(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTests(path)))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(path)
    }
  }
  return files.sort()
}

const tests = await collectTests(resolve('test'))
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'inherit',
})
if (result.error !== undefined) {
  throw result.error
}
process.exitCode = result.status ?? 1
