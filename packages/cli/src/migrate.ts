/**
 * rolekit migrate CLI command.
 */

import { resolve } from 'node:path'
import {
  codestableAdapter,
  MigrationError,
  type MigrationFrom,
  runMigration,
  superpowersAdapter,
} from '@rolekit/migrate'

/**
 * Handles `rolekit migrate ...` argv (without the leading `migrate` token).
 */
export async function cmdMigrate(args: string[], json: boolean): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printMigrateHelp(json)
    process.exitCode = 0
    return
  }

  let from: MigrationFrom | undefined
  let source: string | undefined
  let target = process.cwd()
  let decisions: string | undefined
  let reportDir: string | undefined
  let auditOnly = false

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--from') {
      from = args[++i] as MigrationFrom
      continue
    }
    if (a === '--source') {
      source = args[++i]
      continue
    }
    if (a === '--target') {
      target = args[++i]!
      continue
    }
    if (a === '--decisions') {
      decisions = args[++i]
      continue
    }
    if (a === '--report-dir') {
      reportDir = args[++i]
      continue
    }
    if (a === '--audit-only') {
      auditOnly = true
      continue
    }
    if (a.startsWith('-')) {
      throw new MigrationError('usage_error', {
        message: `unknown flag: ${a}`,
        exitCode: 2,
      })
    }
    throw new MigrationError('usage_error', {
      message: `unexpected argument: ${a}`,
      exitCode: 2,
    })
  }

  if (from !== 'codestable' && from !== 'superpowers') {
    throw new MigrationError('usage_error', {
      message: 'usage: rolekit migrate --from <codestable|superpowers> ...',
      exitCode: 2,
    })
  }
  if (from === 'superpowers' && !source) {
    throw new MigrationError('usage_error', {
      message: 'superpowers requires explicit --source',
      exitCode: 2,
    })
  }
  const sourceRoot = source ?? (from === 'codestable' ? resolve(process.cwd(), '.codestable') : '')
  const adapter = from === 'codestable' ? codestableAdapter : superpowersAdapter

  const result = await runMigration({
    from,
    sourceRoot,
    targetRoot: resolve(target),
    decisionsPath: decisions ? resolve(decisions) : undefined,
    reportDir: reportDir ? resolve(reportDir) : undefined,
    auditOnly,
    adapter,
  })

  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    const m = result.migration
    process.stdout.write(
      `migration ${m.id} ${m.mode} ${m.status}${m.no_op ? ' (no-op)' : ''}\n` +
        `report: ${m.report.base}:${m.report.path}\n`,
    )
  }
  process.exitCode = 0
}

/**
 * Emits migrate usage / JSON error payload for MigrationError.
 */
export function emitMigrateError(error: MigrationError, json: boolean): void {
  if (json) {
    const payload: Record<string, unknown> = {
      error: error.code,
    }
    if (error.migration_id) payload.migration_id = error.migration_id
    if (error.report) payload.report = error.report
    if (error.detail) payload.detail = error.detail
    if (error.issues) payload.issues = error.issues
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  } else {
    process.stderr.write(`${error.code}: ${error.message}\n`)
  }
  process.exitCode = error.exitCode
}

function printMigrateHelp(json: boolean): void {
  const text =
    'Usage:\n' +
    '  rolekit migrate --from <codestable|superpowers> [--source <path>] [--target <project-root>]\n' +
    '                  [--decisions <yaml>] [--report-dir <path>] [--audit-only] [--json]\n'
  if (json) process.stdout.write(`${JSON.stringify({ help: text.trim() })}\n`)
  else process.stdout.write(text)
}
