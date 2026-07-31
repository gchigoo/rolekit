/**
 * CLI for npm run evals:capture — <runDir> <name> <expectation>.
 */

import { resolve } from 'node:path'
import { captureSeed } from './capture.ts'

/**
 * Runs the capture CLI. Exit 0 ok, 1 business failure, 2 usage.
 */
export function runCaptureCli(argv: string[], seedsRoot = 'evals/seeds'): number {
  const args = argv.filter((a) => !a.startsWith('-'))
  const flags = argv.filter((a) => a.startsWith('-'))
  for (const f of flags) {
    if (f !== '--json') {
      process.stderr.write(`usage error: unknown flag ${f}\n`)
      process.stderr.write('usage: rolekit-evals-capture <runDir> <name> <expectation>\n')
      return 2
    }
  }
  if (args.length !== 3) {
    process.stderr.write('usage error: expected <runDir> <name> <expectation>\n')
    process.stderr.write('usage: rolekit-evals-capture <runDir> <name> <expectation>\n')
    return 2
  }
  const [runDir, name, expectation] = args as [string, string, string]
  const result = captureSeed({
    runDir: resolve(runDir),
    name,
    expectation,
    seedsRoot: resolve(seedsRoot),
    source: `pi-rpc-vertical-slice:${name}`,
  })
  if (result.ok) {
    process.stdout.write(`${JSON.stringify({ ok: true, seedDir: result.seedDir }, null, 2)}\n`)
    return 0
  }
  process.stderr.write(
    `${JSON.stringify({ ok: false, code: result.code, message: result.message })}\n`,
  )
  if (result.code === 'usage_error') return 2
  return 1
}
