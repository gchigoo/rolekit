import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

await rm(resolve('dist'), { recursive: true, force: true })
await import('./export-schemas.ts')

const tscPath = resolve('node_modules', 'typescript', 'bin', 'tsc')
const result = spawnSync(process.execPath, [tscPath, '-p', 'tsconfig.build.json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'inherit',
})
if (result.error !== undefined) {
  throw result.error
}
if (result.status !== 0) {
  process.exitCode = result.status ?? 1
}
