import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { CodexCliAdapter } from './adapters/codex/index.ts'
import { CursorCliAdapter } from './adapters/cursor/index.ts'
import { PiCliAdapter } from './adapters/pi/index.ts'
import {
  assertCompilableSchema,
  assertValid,
  Rolekit,
  RolekitError,
  RoleSpecSchema,
  RunResultSchema,
  TaskPacketSchema,
} from './core/index.ts'
import type { ExecutorAdapter, JsonSchema, RoleSpec, RunResult, TaskPacket } from './core/types.ts'

const HELP = `RoleKit

Portable role and task contracts for invoking coding agents across hosts.

Usage:
  rolekit validate role <file> [--json]
  rolekit validate task <file> [--json]
  rolekit validate result <file> [--json]
  rolekit run --role <file> --task <file> --executor <pi|cursor|codex>
              [--cwd <path>] [--options <file>] [--json]
`

class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

interface ParsedArguments {
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, string | true>
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) {
      continue
    }
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    const name = argument.slice(2)
    if (flags.has(name)) {
      throw new CliUsageError(`Flag "--${name}" was provided more than once.`)
    }
    if (name === 'json' || name === 'help') {
      flags.set(name, true)
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new CliUsageError(`Flag "--${name}" requires a value.`)
    }
    flags.set(name, value)
    index += 1
  }
  return { positional, flags }
}

function assertAllowedFlags(parsed: ParsedArguments, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  const unsupported = [...parsed.flags.keys()].filter((flag) => !allowedSet.has(flag))
  if (unsupported.length > 0) {
    throw new CliUsageError(
      `Unsupported flags: ${unsupported.map((flag) => `--${flag}`).join(', ')}.`,
    )
  }
}

function stringFlag(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

function requireStringFlag(parsed: ParsedArguments, name: string): string {
  const value = stringFlag(parsed, name)
  if (value === undefined) {
    throw new CliUsageError(`Missing required flag "--${name}".`)
  }
  return value
}

async function loadData(filePath: string): Promise<unknown> {
  const absolutePath = resolve(filePath)
  const source = await readFile(absolutePath, 'utf8')
  const extension = extname(absolutePath).toLowerCase()
  return extension === '.yaml' || extension === '.yml'
    ? parseYaml(source)
    : (JSON.parse(source) as unknown)
}

function validateRole(value: unknown): asserts value is RoleSpec {
  assertValid(RoleSpecSchema as JsonSchema, value, 'Role')
  const role = value as RoleSpec
  assertCompilableSchema(role.inputSchema, `Role "${role.id}" inputSchema`)
  assertCompilableSchema(role.outputSchema, `Role "${role.id}" outputSchema`)
}

function validateTask(value: unknown): asserts value is TaskPacket {
  assertValid(TaskPacketSchema as JsonSchema, value, 'Task')
}

function validateResult(value: unknown): asserts value is RunResult {
  assertValid(RunResultSchema as JsonSchema, value, 'Run result')
}

function adapterFor(id: string): ExecutorAdapter {
  switch (id) {
    case 'pi':
      return new PiCliAdapter()
    case 'cursor':
      return new CursorCliAdapter()
    case 'codex':
      return new CodexCliAdapter()
    default:
      throw new CliUsageError(`Unknown executor "${id}". Expected pi, cursor, or codex.`)
  }
}

function printValue(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function validateCommand(parsed: ParsedArguments): Promise<number> {
  assertAllowedFlags(parsed, ['json'])
  const kind = parsed.positional[1]
  const file = parsed.positional[2]
  if (kind === undefined || file === undefined || parsed.positional.length !== 3) {
    throw new CliUsageError('Validate requires a kind and a file path.')
  }
  const value = await loadData(file)
  switch (kind) {
    case 'role':
      validateRole(value)
      break
    case 'task':
      validateTask(value)
      break
    case 'result':
      validateResult(value)
      break
    default:
      throw new CliUsageError(`Unknown contract kind "${kind}".`)
  }

  if (parsed.flags.has('json')) {
    printValue({ valid: true, kind, file: resolve(file) })
  } else {
    process.stdout.write(`Valid ${kind}: ${resolve(file)}\n`)
  }
  return 0
}

async function runCommand(parsed: ParsedArguments): Promise<number> {
  assertAllowedFlags(parsed, ['role', 'task', 'executor', 'cwd', 'options', 'json'])
  if (parsed.positional.length !== 1) {
    throw new CliUsageError('Run accepts flags only.')
  }
  const rolePath = requireStringFlag(parsed, 'role')
  const taskPath = requireStringFlag(parsed, 'task')
  const executorId = requireStringFlag(parsed, 'executor')
  const roleValue = await loadData(rolePath)
  const taskValue = await loadData(taskPath)
  validateRole(roleValue)
  validateTask(taskValue)

  const adapterOptionsPath = stringFlag(parsed, 'options')
  const adapterOptions = adapterOptionsPath === undefined ? {} : await loadData(adapterOptionsPath)
  const adapter = adapterFor(executorId)
  const rolekit = new Rolekit({
    roles: [roleValue],
    adapters: [adapter],
  })
  const result = await rolekit.run(taskValue, {
    executorId,
    cwd: resolve(stringFlag(parsed, 'cwd') ?? process.cwd()),
    adapterOptions,
  })

  if (parsed.flags.has('json')) {
    printValue(result)
  } else {
    process.stdout.write(`[${result.status}] ${result.runId}: ${result.summary}\n`)
  }
  switch (result.status) {
    case 'completed':
      return 0
    case 'blocked':
      return 3
    case 'failed':
    case 'cancelled':
      return 1
  }
}

export async function runCli(args: readonly string[]): Promise<number> {
  const parsed = parseArguments(args)
  if (parsed.flags.has('help') || parsed.positional[0] === 'help' || args.length === 0) {
    process.stdout.write(HELP)
    return 0
  }
  switch (parsed.positional[0]) {
    case 'validate':
      return validateCommand(parsed)
    case 'run':
      return runCommand(parsed)
    default:
      throw new CliUsageError(`Unknown command "${parsed.positional[0] ?? ''}".`)
  }
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    process.exitCode = await runCli(args)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const code =
      error instanceof RolekitError
        ? error.code
        : error instanceof CliUsageError
          ? 'usage_error'
          : 'unexpected_error'
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`)
    process.exitCode = error instanceof CliUsageError || error instanceof RolekitError ? 2 : 1
  }
}
