import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { freezeJsonSnapshot } from '../../core/json.ts'
import type {
  Capability,
  ContextIsolation,
  ExecutionAdmission,
  ExecutionContext,
  ExecutorProbe,
  ExecutorResponse,
  ExecutorSupportFeatures,
  JsonObject,
  PreparedExecutorOptions,
  PublicOptionContext,
  RoleSpec,
  TaskPacket,
  TokenUsage,
} from '../../core/types.ts'
import {
  buildCliArgumentPlan,
  CliAdapterBase,
  type CliArgumentPlan,
  type CliCompatibilityBehaviorCheck,
  type CliProbeEnvironment,
  exactValueBehaviorCheck,
} from '../cli/base.ts'
import { CliExitError } from '../cli/errors.ts'
import { isolatedUserEnvironment } from '../cli/options.ts'
import {
  firstNumber,
  firstString,
  parseExecutorPayload,
  parseJsonLines,
  readUsage,
  withoutExecutorIdentity,
} from '../cli/parse.ts'
import { buildNeutralExecutionPrompt } from '../cli/prompt.ts'
import {
  CURSOR_AUTHENTICATION_ENVIRONMENT_KEYS,
  type CursorCliAdapterOptions,
  prepareCursorCliAdapterOptions,
} from './options.ts'

export interface CursorStreamResult {
  readonly finalText: string
  readonly model?: string
  readonly usage?: TokenUsage
}

const CURSOR_INVALID_OUTPUT_FORMAT_STDERR =
  "error: invalid value 'rolekit-invalid-value-canary' for '--output-format <OUTPUT_FORMAT>'\n  [possible values: text, json, stream-json]\n\nFor more information, try '--help'.\n"

function matchesCursorInvalidOutputFormat(error: unknown): boolean {
  return (
    error instanceof CliExitError &&
    error.exitCode === 2 &&
    error.signal === undefined &&
    (error.stdout ?? '').replace(/\r\n/gu, '\n') === '' &&
    (error.stderr ?? '').replace(/\r\n/gu, '\n') === CURSOR_INVALID_OUTPUT_FORMAT_STDERR
  )
}

export function parseCursorStream(stdout: string): CursorStreamResult {
  let finalText: string | undefined
  let model: string | undefined
  let usage: TokenUsage | undefined

  for (const event of parseJsonLines(stdout)) {
    const type = firstString(event, 'type')
    const subtype = firstString(event, 'subtype')
    if (type === 'system' && subtype === 'init') {
      model = firstString(event, 'model') ?? model
    }
    if (type === 'result') {
      finalText = firstString(event, 'result', 'text', 'content') ?? finalText
      model = firstString(event, 'model') ?? model
      usage = readUsage(event.usage) ?? usage
      const durationMs = firstNumber(event, 'duration_ms', 'durationMs')
      if (durationMs !== undefined) {
        usage = { ...usage, durationMs }
      }
    }
  }

  if (finalText === undefined) {
    throw new Error('Cursor CLI stream did not contain a terminal result.')
  }
  return {
    finalText,
    ...(model === undefined ? {} : { model }),
    ...(usage === undefined ? {} : { usage }),
  }
}

function mergeUsage(
  response: ExecutorResponse,
  detected: TokenUsage | undefined,
  durationMs: number,
): TokenUsage {
  const responseUsage = readUsage(response.usage) ?? {}
  return {
    ...detected,
    ...responseUsage,
    durationMs: responseUsage.durationMs ?? detected?.durationMs ?? durationMs,
  }
}

function buildCursorArgumentPlan(
  options: Readonly<CursorCliAdapterOptions>,
  cwd: string,
  writeMode: boolean,
): CliArgumentPlan {
  return buildCliArgumentPlan([
    { flag: '--print' },
    { flag: '--output-format', values: ['stream-json'] },
    { flag: '--workspace', values: [cwd] },
    { flag: '--trust' },
    { flag: '--sandbox', values: [options.sandbox ?? 'enabled'] },
    ...(writeMode ? [{ flag: '--force' }] : [{ flag: '--mode', values: ['plan'] }]),
    ...(options.approveMcps === true ? [{ flag: '--approve-mcps' }] : []),
    ...(options.model === undefined ? [] : [{ flag: '--model', values: [options.model] }]),
  ])
}

async function createCursorEnvironment(
  options: Readonly<CursorCliAdapterOptions>,
): Promise<CliProbeEnvironment> {
  if (options.inheritAmbientEnvironment === true) {
    return {}
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-cursor-'))
  return {
    overrides: isolatedUserEnvironment(temporaryDirectory),
    cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
  }
}

export class CursorCliAdapter extends CliAdapterBase<CursorCliAdapterOptions> {
  readonly id = 'cursor'
  protected readonly displayName = 'Cursor Agent CLI'
  protected readonly defaultCommand = 'agent'
  protected readonly defaultCapabilities: readonly Capability[] = [
    'repository.read',
    'repository.write',
    'shell',
  ]
  protected override readonly authenticationEnvironmentKeys = CURSOR_AUTHENTICATION_ENVIRONMENT_KEYS
  protected override readonly minimumTestedVersion = '1.0.0'

  override prepareOptions(
    options: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<CursorCliAdapterOptions> {
    return prepareCursorCliAdapterOptions(options, publicContext)
  }

  protected override prepareProbeEnvironment(
    options: Readonly<CursorCliAdapterOptions>,
  ): Promise<CliProbeEnvironment> {
    return createCursorEnvironment(options)
  }

  protected override requiredProbeHelpTokens(
    prepared: PreparedExecutorOptions<CursorCliAdapterOptions>,
  ): readonly string[] {
    return [
      ...new Set([
        ...buildCursorArgumentPlan(prepared.executionOptions, '.', false).helpTokens,
        ...buildCursorArgumentPlan(prepared.executionOptions, '.', true).helpTokens,
      ]),
    ]
  }

  protected override compatibilityProbeFeatures(
    _prepared: PreparedExecutorOptions<CursorCliAdapterOptions>,
  ): Readonly<Record<string, readonly string[]>> {
    return {
      print: ['--print'],
      sandbox: ['--sandbox'],
      workspace: ['--workspace'],
    }
  }

  protected override compatibilityBehaviorChecks(
    prepared: PreparedExecutorOptions<CursorCliAdapterOptions>,
  ): readonly CliCompatibilityBehaviorCheck[] {
    return [
      exactValueBehaviorCheck(
        'output:stream-json',
        buildCursorArgumentPlan(prepared.executionOptions, '.', false),
        '--output-format',
        1,
        { matchesRejectedError: matchesCursorInvalidOutputFormat },
      ),
    ]
  }

  override admit(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<CursorCliAdapterOptions>,
    probe?: ExecutorProbe,
  ): ExecutionAdmission {
    const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
    if (required.has('shell') && !required.has('repository.write')) {
      return freezeJsonSnapshot(
        {
          allowed: false,
          effectiveCapabilities: ['repository.read'],
          effectivePublicOptions: this.effectivePublicOptions(role, task, prepared),
          pathEnforcement: 'advisory',
          contextIsolation: this.contextIsolation(prepared.executionOptions),
          blockedError: {
            code: 'unsupported_permission_combination',
            message:
              'Cursor shell execution without repository.write cannot guarantee write isolation.',
            retryable: false,
            details: {
              required: [...required],
              unsupportedCombination: 'shell-without-repository.write',
            },
          },
        },
        'Cursor execution admission',
      ) as ExecutionAdmission
    }
    return super.admit(role, task, prepared, probe)
  }

  protected override effectiveCapabilities(
    role: RoleSpec,
    task: TaskPacket,
    _options: Readonly<CursorCliAdapterOptions>,
  ): readonly Capability[] {
    const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
    return required.has('repository.write')
      ? ['repository.read', 'repository.write', 'shell']
      : ['repository.read']
  }

  protected override supportFeatures(
    options: Readonly<CursorCliAdapterOptions>,
  ): ExecutorSupportFeatures {
    return {
      structuredOutput: 'prompt',
      events: true,
      cancellation: 'process',
      contextIsolation: this.contextIsolation(options),
      supportedPathEnforcement: ['advisory'],
      permissionCombinations: [
        'repository.read',
        'repository.read+repository.write',
        'repository.read+repository.write+shell',
      ],
    }
  }

  protected override contextIsolation(
    options: Readonly<CursorCliAdapterOptions>,
  ): ContextIsolation {
    return {
      userConfig: 'unknown',
      projectInstructions: 'unknown',
      projectResources: 'unknown',
      environment: options.inheritAmbientEnvironment === true ? 'inherited' : 'minimal',
      credentials: options.inheritAmbientEnvironment === true ? 'inherited' : 'explicit',
    }
  }

  protected override effectivePublicOptions(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<CursorCliAdapterOptions>,
  ): JsonObject {
    const options = prepared.executionOptions
    const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
    const writeMode = required.has('repository.write')
    return {
      ...prepared.publicOptions,
      ...this.credentialPublicOptions(options),
      command: options.command ?? this.defaultCommand,
      inheritAmbientEnvironment: options.inheritAmbientEnvironment ?? false,
      sandbox: options.sandbox ?? 'enabled',
      approveMcps: options.approveMcps ?? false,
      workspaceTrust: true,
      executionMode: writeMode ? 'write' : 'plan',
      force: writeMode,
      pathEnforcement: 'advisory',
    }
  }

  protected async executeCli(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<CursorCliAdapterOptions>,
    options: CursorCliAdapterOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
    const writeMode = required.has('repository.write')
    const argumentPlan = buildCursorArgumentPlan(options, context.cwd, writeMode)
    const environment = await createCursorEnvironment(options)
    try {
      const processResult = await this.run(
        context,
        options,
        argumentPlan.args,
        buildNeutralExecutionPrompt(role, task),
        signal,
        environment.overrides,
      )
      if (processResult.exitCode !== 0) {
        throw new Error(
          processResult.stderr.trim() || `Cursor CLI exited with code ${processResult.exitCode}.`,
        )
      }

      const { parsed, response } = this.parseProtocol(options, context.sensitiveValues, () => {
        const parsed = parseCursorStream(processResult.stdout)
        const response = withoutExecutorIdentity(parseExecutorPayload(parsed.finalText))
        return { parsed, response }
      })
      return {
        ...response,
        evidence: [
          ...(Array.isArray(response.evidence) ? response.evidence : []),
          {
            kind: 'command',
            value: processResult.commandDisplay,
            description: 'Cursor CLI invocation',
          },
        ],
        usage: mergeUsage(response, parsed.usage, processResult.durationMs),
        ...(parsed.model === undefined ? {} : { model: parsed.model }),
      }
    } finally {
      await environment.cleanup?.()
    }
  }
}
