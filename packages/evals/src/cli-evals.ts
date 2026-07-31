/**
 * CLI for npm run evals — traverse seeds, emit JSON report, exit 0/1/2.
 */

import { resolve } from 'node:path'
import { evaluateLedger } from './ledger.ts'

/**
 * Runs the evals ledger CLI.
 */
export function runEvalsCli(argv: string[]): number {
  const args = argv.filter((a) => a !== '--json')
  const summary = args.includes('--summary')
  const positional = args.filter((a) => a !== '--summary' && !a.startsWith('-'))
  for (const a of args) {
    if (a.startsWith('-') && a !== '--summary' && a !== '--json') {
      process.stderr.write(`usage error: unknown flag ${a}\n`)
      process.stderr.write('usage: rolekit-evals [seedsDir] [--summary]\n')
      return 2
    }
  }
  if (positional.length > 1) {
    process.stderr.write('usage error: unexpected extra argument\n')
    process.stderr.write('usage: rolekit-evals [seedsDir] [--summary]\n')
    return 2
  }

  const seedsDir = resolve(positional[0] ?? 'evals/seeds')
  const report = evaluateLedger(seedsDir)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (summary) {
    process.stderr.write(
      `verdict=${report.verdict}` +
        (report.reason ? ` reason=${report.reason}` : '') +
        ` runs=${report.runs.length}\n`,
    )
  }
  if (report.verdict === 'pass') return 0
  return 1
}
