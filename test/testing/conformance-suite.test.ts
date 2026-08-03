import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

import { Type } from '@sinclair/typebox'
import { parse as parseYaml } from 'yaml'

import {
  cliVersionAtLeast,
  createCliCompatibilityReport,
  parseCliVersion,
} from '../../src/adapters/cli/index.ts'
import { parseExecutorPayload } from '../../src/adapters/cli/parse.ts'
import { CodexCliAdapter, parseCodexEvents } from '../../src/adapters/codex/index.ts'
import { CursorCliAdapter, parseCursorStream } from '../../src/adapters/cursor/index.ts'
import { PiCliAdapter, parsePiStream } from '../../src/adapters/pi/index.ts'
import { PiRpcAdapter } from '../../src/adapters/pi-rpc/index.ts'
import { Rolekit } from '../../src/core/rolekit.ts'
import type {
  ExecutionContext,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  ExecutorResponse,
  RoleSpec,
  TaskPacket,
} from '../../src/core/types.ts'
import {
  checkAdapterConformance,
  defineAdapterConformanceSuite,
  FakeExecutorAdapter,
} from '../../src/testing/index.ts'

const isolation = {
  userConfig: 'isolated',
  projectInstructions: 'isolated',
  projectResources: 'isolated',
  environment: 'minimal',
  credentials: 'explicit',
} as const

const descriptor: ExecutorDescriptorV2 = {
  schema: 'rolekit/executor-descriptor@2',
  adapterProtocol: 'rolekit/executor-adapter@1',
  adapterVersion: '1.0.0',
  id: 'conformance-fixture',
  displayName: 'Conformance fixture',
  transport: 'in-process',
  capabilities: ['repository.read'],
  features: {
    structuredOutput: 'native',
    events: true,
    cancellation: 'protocol',
    contextIsolation: isolation,
    supportedPathEnforcement: ['advisory'],
    permissionCombinations: ['repository.read'],
  },
}

const role: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
  schema: 'rolekit/role-spec@1',
  id: 'conformance-role',
  description: 'Exercises one adapter boundary.',
  requiredCapabilities: ['repository.read'],
  inputSchema: Type.Object({ source: Type.String() }, { additionalProperties: false }),
  outputSchema: Type.Object({ message: Type.String() }, { additionalProperties: false }),
}

const task: TaskPacket<{ readonly source: string }> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'conformance-task',
  roleId: role.id,
  objective: 'Return one bounded report.',
  input: { source: 'fixture.txt' },
  context: [],
  constraints: [],
  acceptanceCriteria: ['Return the requested output and artifact.'],
  allowedPaths: ['fixture.txt'],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

const completedResponse: ExecutorResponse<{ readonly message: string }> = {
  status: 'completed',
  summary: 'Conformance fixture completed.',
  output: { message: 'ok' },
  artifacts: [{ name: 'report', kind: 'text', content: 'ok' }],
  evidence: [],
}

function conformanceInput(
  adapter: FakeExecutorAdapter,
  overrides: { readonly signal?: AbortSignal } = {},
) {
  return {
    adapter,
    role,
    task,
    runId: 'conformance-run',
    cwd: '/fixture',
    options: {},
    ...(overrides.signal === undefined ? {} : { signal: overrides.signal }),
  }
}

function countingAdapter<TOptions>(
  adapter: ExecutorAdapter<TOptions>,
  onExecute: () => void,
): ExecutorAdapter<TOptions> {
  return {
    id: adapter.id,
    ...(adapter.sensitiveOptionPointers === undefined
      ? {}
      : { sensitiveOptionPointers: adapter.sensitiveOptionPointers }),
    prepareOptions: (options, publicContext) => adapter.prepareOptions(options, publicContext),
    inspect: (prepared) => adapter.inspect(prepared),
    ...(adapter.prepareProbeOptions === undefined
      ? {}
      : {
          prepareProbeOptions: (prepared) =>
            adapter.prepareProbeOptions?.(prepared) as ReturnType<typeof adapter.prepareOptions>,
        }),
    probe: (prepared, context) => adapter.probe(prepared, context),
    admit: (roleValue, taskValue, prepared, probe) =>
      adapter.admit(roleValue, taskValue, prepared, probe),
    execute: (roleValue, taskValue, context) => {
      onExecute()
      return adapter.execute(roleValue, taskValue, context)
    },
    ...(adapter.cancel === undefined
      ? {}
      : { cancel: (runId: string) => adapter.cancel?.(runId) ?? Promise.resolve() }),
  }
}

describe('adapter conformance false-positive coverage', () => {
  it('rejects completed responses with error or without output', async () => {
    for (const response of [
      {
        status: 'completed',
        summary: 'Invalid completed response.',
        artifacts: [{ name: 'report', kind: 'text', content: 'invalid' }],
        evidence: [],
        error: { code: 'unexpected', message: 'Unexpected error.', retryable: false },
      },
      {
        status: 'completed',
        summary: 'Invalid completed response.',
        artifacts: [{ name: 'report', kind: 'text', content: 'invalid' }],
        evidence: [],
      },
    ] as const) {
      const report = await checkAdapterConformance(
        conformanceInput(
          new FakeExecutorAdapter({
            descriptor,
            response: response as unknown as ExecutorResponse,
          }),
        ),
      )

      assert.equal(report.valid, false)
      assert.match(report.errors.join('\n'), /completed.*output.*error/u)
    }
  })

  it('rejects failed, blocked, and cancelled responses with output or without error', async () => {
    for (const status of ['failed', 'blocked', 'cancelled'] as const) {
      for (const response of [
        {
          status,
          summary: `Invalid ${status} response.`,
          output: { message: 'must not be present' },
          artifacts: [],
          evidence: [],
          error: { code: status, message: `${status} error`, retryable: false },
        },
        {
          status,
          summary: `Invalid ${status} response.`,
          artifacts: [],
          evidence: [],
        },
      ] as const) {
        const report = await checkAdapterConformance(
          conformanceInput(
            new FakeExecutorAdapter({
              descriptor,
              response: response as unknown as ExecutorResponse,
            }),
          ),
        )

        assert.equal(report.valid, false, status)
        assert.match(report.errors.join('\n'), /all other responses.*error.*output/u)
      }
    }
  })

  it('checks role output and expected artifact completeness, content, and uniqueness', async () => {
    const invalidOutput = await checkAdapterConformance(
      conformanceInput(
        new FakeExecutorAdapter({
          descriptor,
          response: {
            ...completedResponse,
            output: { message: 42 },
          } as unknown as ExecutorResponse,
        }),
      ),
    )
    assert.equal(invalidOutput.valid, false)
    assert.match(invalidOutput.errors.join('\n'), /output.*role schema/iu)

    const missingArtifact = await checkAdapterConformance(
      conformanceInput(
        new FakeExecutorAdapter({
          descriptor,
          response: { ...completedResponse, artifacts: [] },
        }),
      ),
    )
    assert.equal(missingArtifact.valid, false)
    assert.match(missingArtifact.errors.join('\n'), /missing.*report.*text|expected artifact/iu)

    const emptyArtifact = await checkAdapterConformance(
      conformanceInput(
        new FakeExecutorAdapter({
          descriptor,
          response: {
            ...completedResponse,
            artifacts: [{ name: 'report', kind: 'text', content: '' }],
          },
        }),
      ),
    )
    assert.equal(emptyArtifact.valid, false)
    assert.match(emptyArtifact.errors.join('\n'), /artifact.*content.*empty|empty.*artifact/iu)

    const duplicateArtifact = await checkAdapterConformance(
      conformanceInput(
        new FakeExecutorAdapter({
          descriptor,
          response: {
            ...completedResponse,
            artifacts: [
              { name: 'report', kind: 'text', content: 'first' },
              { name: 'report', kind: 'text', content: 'second' },
            ],
          },
        }),
      ),
    )
    assert.equal(duplicateArtifact.valid, false)
    assert.match(duplicateArtifact.errors.join('\n'), /duplicate.*artifact|artifact.*unique/iu)
  })

  it('checks cancellation and event behavior', async () => {
    const controller = new AbortController()
    let cleanedUp = false
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: async ({ context }) => {
        await new Promise<void>((resolvePromise) => {
          context.signal?.addEventListener('abort', () => resolvePromise(), { once: true })
        })
        cleanedUp = true
        return completedResponse
      },
    })

    const reportPromise = checkAdapterConformance(
      conformanceInput(adapter, { signal: controller.signal }),
    )
    while (adapter.invocations.length === 0) {
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    }
    controller.abort()
    const report = await reportPromise

    assert.equal(report.valid, false)
    assert.match(report.errors.join('\n'), /cancelled|cancellation|cleanup/iu)
    assert.equal(cleanedUp, true)
  })

  it('checks that RoleKit-owned process surfaces contain no fixture secret', async () => {
    const secret = 'CONFORMANCE_FIXTURE_SENTINEL_9A7F'
    const adapter = new FakeExecutorAdapter({
      descriptor,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions: () =>
        Object.freeze({
          executionOptions: Object.freeze({ environment: Object.freeze({ TOKEN: secret }) }),
          publicOptions: Object.freeze({
            environment: Object.freeze({
              TOKEN: Object.freeze({ source: 'literal', redacted: true as const }),
            }),
          }),
          sensitiveValues: Object.freeze([secret]),
        }),
      response: ({ context }: { readonly context: ExecutionContext }) => {
        if (context.emitEvent === undefined) {
          throw new Error(`RoleKit event surface was unavailable for ${secret}`)
        }
        context.emitEvent({
          type: 'diagnostic',
          level: 'warning',
          message: `fixture stderr exposed ${secret}`,
        })
        return {
          ...completedResponse,
          evidence: [
            {
              kind: 'command',
              value: `fixture --token ${secret}`,
              description: `fixture command exposed ${secret}`,
            },
          ],
        }
      },
    })

    const report = await checkAdapterConformance(conformanceInput(adapter))
    const surface = JSON.stringify(report)

    assert.equal(report.valid, true, report.errors.join('\n'))
    assert.doesNotMatch(surface, new RegExp(secret, 'u'))
    assert.match(surface, /\[REDACTED\]/u)
  })
})

const cliFixture = resolve('test', 'fixtures', 'fake-cli.mjs')
const piRpcFixture = resolve('test', 'fixtures', 'fake-pi-rpc.mjs')
const unavailableCommand = resolve('test', 'fixtures', 'not-installed-rolekit-adapter')

async function createCodexBehaviorFixture(missingFeature: string): Promise<{
  readonly command: string
  readonly cleanup: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-codex-behavior-fixture-'))
  const scriptPath = join(directory, 'codex-behavior-fixture.mjs')
  await writeFile(
    scriptPath,
    [
      '#!/usr/bin/env node',
      `process.env.ROLEKIT_FAKE_MISSING_FEATURE = ${JSON.stringify(missingFeature)}`,
      `await import(${JSON.stringify(pathToFileURL(cliFixture).href)})`,
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(scriptPath, 0o755)
  if (process.platform !== 'win32') {
    return {
      command: scriptPath,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  }
  const commandPath = join(directory, 'codex-behavior-fixture.cmd')
  await writeFile(commandPath, `@"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8')
  return {
    command: commandPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}
const fixtureSecrets = {
  pi: 'PI_CONFORMANCE_SECRET_3F18',
  piRpc: 'PI_RPC_CONFORMANCE_SECRET_7C21',
  cursor: 'CURSOR_CONFORMANCE_SECRET_5D42',
  codex: 'CODEX_CONFORMANCE_SECRET_8B64',
} as const

defineAdapterConformanceSuite('Pi one-shot', {
  createAdapter: () => new PiCliAdapter(),
  validRawOptions: {
    command: cliFixture,
    tools: ['read'],
    environment: { XAI_API_KEY: fixtureSecrets.pi },
  },
  unavailableRawOptions: { command: unavailableCommand, tools: ['read'] },
  capabilities: ['repository.read'],
})

defineAdapterConformanceSuite('Pi RPC', {
  createAdapter: () => new PiRpcAdapter(),
  validRawOptions: {
    command: piRpcFixture,
    tools: ['read'],
    environment: { XAI_API_KEY: fixtureSecrets.piRpc },
  },
  unavailableRawOptions: { command: unavailableCommand, tools: ['read'] },
  capabilities: ['repository.read'],
})

defineAdapterConformanceSuite('Cursor', {
  createAdapter: () => new CursorCliAdapter(),
  validRawOptions: {
    command: cliFixture,
    environment: { CURSOR_API_KEY: fixtureSecrets.cursor },
  },
  unavailableRawOptions: { command: unavailableCommand },
  capabilities: ['repository.read'],
})

defineAdapterConformanceSuite('Codex', {
  createAdapter: () => new CodexCliAdapter(),
  validRawOptions: {
    command: cliFixture,
    environment: { OPENAI_API_KEY: fixtureSecrets.codex },
  },
  unavailableRawOptions: { command: unavailableCommand },
  capabilities: ['repository.read'],
})

async function protocolFixture(adapter: 'pi' | 'cursor' | 'codex', name: string): Promise<string> {
  return readFile(resolve('test', 'fixtures', 'protocol', adapter, `${name}.jsonl`), 'utf8')
}

describe('CLI compatibility matrix', () => {
  it('parses versions deterministically but never treats semver as sufficient', () => {
    assert.deepEqual(parseCliVersion('codex-cli 0.146.0\n'), {
      raw: 'codex-cli 0.146.0',
      version: '0.146.0',
      major: 0,
      minor: 146,
      patch: 0,
    })
    const report = createCliCompatibilityReport({
      command: 'codex',
      versionOutput: 'codex-cli 99.0.0',
      minimumTestedVersion: '0.146.0',
      featureChecks: {
        'exec:json': true,
        'structured-output:output-schema': false,
      },
      criticalFeatures: ['exec:json', 'structured-output:output-schema'],
    })

    assert.equal(report.versionMeetsMinimum, true)
    assert.equal(report.compatible, false)
    assert.deepEqual(report.missingCriticalFeatures, ['structured-output:output-schema'])
    assert.equal(Object.isFrozen(report), true)
  })

  it('parses and compares SemVer prereleases according to SemVer precedence', () => {
    const version = (value: string) => {
      const parsed = parseCliVersion(value)
      assert.ok(parsed, value)
      return parsed
    }

    assert.equal(cliVersionAtLeast(version('tool 1.0.0-rc.10'), '1.0.0-rc.2'), true)
    assert.equal(cliVersionAtLeast(version('tool 1.0.0-rc.2'), '1.0.0-rc.10'), false)
    assert.equal(cliVersionAtLeast(version('tool 1.0.0-1'), '1.0.0-alpha'), false)
    assert.equal(cliVersionAtLeast(version('tool 1.0.0-alpha'), '1.0.0-1'), true)
    assert.equal(cliVersionAtLeast(version('tool 1.0.0'), '1.0.0-rc.99'), true)
    assert.equal(cliVersionAtLeast(version('tool 1.0.0-rc.99'), '1.0.0'), false)
    assert.equal(parseCliVersion('tool 01.2.3'), undefined)
    assert.equal(parseCliVersion('tool 1.02.3'), undefined)
    assert.equal(parseCliVersion('tool 1.2.03'), undefined)
    assert.equal(parseCliVersion('tool 1.2.3-rc.01'), undefined)
    assert.equal(parseCliVersion('tool 1.2'), undefined)
    assert.equal(parseCliVersion('tool 1.2.3-'), undefined)
    assert.deepEqual(parseCliVersion('diagnostic line\nCodex CLI version v2.3.4-rc.2+build.7\n'), {
      raw: 'Codex CLI version v2.3.4-rc.2+build.7',
      version: '2.3.4-rc.2+build.7',
      major: 2,
      minor: 3,
      patch: 4,
      prerelease: 'rc.2',
      build: 'build.7',
    })
  })

  it('reports every safety-critical built-in feature through production probes', async () => {
    const cases = [
      {
        adapter: new PiCliAdapter(),
        options: { command: cliFixture, tools: ['read'] },
        features: [
          'mode:json',
          'isolation:no-context-files',
          'isolation:resource-discovery-controls',
          'tools',
          'thinking',
        ],
      },
      {
        adapter: new PiRpcAdapter(),
        options: { command: piRpcFixture, tools: ['read'] },
        features: [
          'mode:rpc',
          'rpc:get_state',
          'rpc:set_thinking_level',
          'rpc:abort',
          'rpc:request_correlation',
        ],
      },
      {
        adapter: new CodexCliAdapter(),
        options: { command: cliFixture },
        features: [
          'exec:json',
          'structured-output:output-schema',
          'ephemeral',
          'isolation:user-config',
          'isolation:rules',
          'behavior:typed-config-project-doc-max-bytes-zero',
        ],
      },
      {
        adapter: new CursorCliAdapter(),
        options: { command: cliFixture },
        features: ['print', 'output:stream-json', 'sandbox', 'workspace'],
      },
    ] as const

    for (const testCase of cases) {
      const prepared = testCase.adapter.prepareOptions(testCase.options)
      const probe = await testCase.adapter.probe(prepared as never, { cwd: process.cwd() })
      assert.equal(probe.available, true, `${testCase.adapter.id}: ${probe.diagnostic}`)
      assert.equal(probe.featureChecks['version:parsed'], true, testCase.adapter.id)
      assert.equal(probe.featureChecks['version:minimum-tested'], true, testCase.adapter.id)
      for (const feature of testCase.features) {
        assert.equal(probe.featureChecks[feature], true, `${testCase.adapter.id}:${feature}`)
      }
    }
  })

  it('keeps Codex web and non-web requests inside reusable descriptor/admission invariants', async () => {
    const webRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...role,
      id: 'codex-web-conformance-role',
      requiredCapabilities: ['repository.read', 'web'],
    }
    const webTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      taskId: 'codex-web-conformance-task',
      roleId: webRole.id,
    }
    const cases = [
      { label: 'non-web-required', role, task },
      { label: 'web-required', role: webRole, task: webTask },
    ] as const

    for (const testCase of cases) {
      const report = await checkAdapterConformance({
        adapter: new CodexCliAdapter(),
        role: testCase.role,
        task: testCase.task,
        runId: `codex-${testCase.label}`,
        cwd: process.cwd(),
        options: { command: cliFixture, webSearch: true },
      })

      assert.equal(report.valid, true, `${testCase.label}: ${report.errors.join('\n')}`)
      assert.ok(report.descriptor?.capabilities.includes('web'), testCase.label)
      assert.ok(report.admission?.effectiveCapabilities.includes('web'), testCase.label)
      assert.equal(report.admission?.allowed, true, testCase.label)
    }
  })

  it('blocks every built-in before execute when one critical production feature is missing', async () => {
    const cases: readonly {
      readonly adapter: ExecutorAdapter
      readonly options: unknown
      readonly missingFeature: string
    }[] = [
      {
        adapter: new PiCliAdapter() as ExecutorAdapter,
        options: {
          command: cliFixture,
          tools: ['read'],
          environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'pi-mode-json' },
        },
        missingFeature: 'mode:json',
      },
      {
        adapter: new PiRpcAdapter() as ExecutorAdapter,
        options: {
          command: piRpcFixture,
          tools: ['read'],
          environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'pi-rpc-mode-rpc' },
        },
        missingFeature: 'mode:rpc',
      },
      {
        adapter: new CodexCliAdapter() as ExecutorAdapter,
        options: {
          command: cliFixture,
          environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'codex-output-schema' },
        },
        missingFeature: 'structured-output:output-schema',
      },
      {
        adapter: new CursorCliAdapter() as ExecutorAdapter,
        options: {
          command: cliFixture,
          environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'cursor-stream-json' },
        },
        missingFeature: 'output:stream-json',
      },
    ]

    for (const testCase of cases) {
      const prepared = testCase.adapter.prepareOptions(testCase.options)
      const probe = await testCase.adapter.probe(prepared, { cwd: process.cwd() })
      assert.equal(probe.available, false, testCase.adapter.id)
      assert.equal(probe.featureChecks[testCase.missingFeature], false, testCase.adapter.id)
      const admission = testCase.adapter.admit(role, task, prepared, probe)
      assert.equal(admission.allowed, false, testCase.adapter.id)

      let executeCount = 0
      const counted = countingAdapter(testCase.adapter, () => {
        executeCount += 1
      })
      const result = await new Rolekit({ roles: [role], adapters: [counted] }).run(task, {
        executorId: counted.id,
        cwd: process.cwd(),
        adapterOptions: testCase.options,
        runId: `${counted.id}-missing-critical-feature`,
      })
      assert.equal(result.status, 'blocked', counted.id)
      assert.equal(executeCount, 0, counted.id)
    }
  })

  it('requires the documented Pi JSON session event instead of accepting arbitrary JSON', async () => {
    const adapter = new PiCliAdapter()
    const prepared = adapter.prepareOptions({
      command: cliFixture,
      tools: ['read'],
      environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'pi-non-session-json-canary' },
    })

    const probe = await adapter.probe(prepared, { cwd: process.cwd() })
    assert.equal(probe.available, false)
    assert.equal(probe.featureChecks['mode:json'], false)
  })

  it('fails closed when a CLI ignores required and invalid value canaries', async () => {
    const cases: readonly {
      readonly adapter: ExecutorAdapter
      readonly options: unknown
      readonly feature: string
    }[] = [
      {
        adapter: new PiCliAdapter() as ExecutorAdapter,
        options: {
          command: cliFixture,
          tools: ['read'],
          environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'pi-ignore-extra-operands' },
        },
        feature: 'mode:json',
      },
      {
        adapter: new CursorCliAdapter() as ExecutorAdapter,
        options: {
          command: cliFixture,
          environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'cursor-ignore-extra-operands' },
        },
        feature: 'output:stream-json',
      },
    ]

    for (const testCase of cases) {
      const prepared = testCase.adapter.prepareOptions(testCase.options)
      const probe = await testCase.adapter.probe(prepared, { cwd: process.cwd() })
      assert.equal(probe.available, false, testCase.adapter.id)
      assert.equal(probe.featureChecks[testCase.feature], false, testCase.adapter.id)

      let executeCount = 0
      const counted = countingAdapter(testCase.adapter, () => {
        executeCount += 1
      })
      const result = await new Rolekit({ roles: [role], adapters: [counted] }).run(task, {
        executorId: counted.id,
        cwd: process.cwd(),
        adapterOptions: testCase.options,
        runId: `${counted.id}-ignored-value-canary`,
      })
      assert.equal(result.status, 'blocked', counted.id)
      assert.equal(executeCount, 0, counted.id)
    }
  })

  it('fails Codex closed when exact typed project-doc or requested web controls are ignored or rejected', async () => {
    const cases = [
      {
        missingFeature: 'codex-ignore-project-doc-config',
        feature: 'behavior:typed-config-project-doc-max-bytes-zero',
        webSearch: false,
        projectIsolation: 'unknown',
      },
      {
        missingFeature: 'codex-reject-project-doc-config',
        feature: 'behavior:typed-config-project-doc-max-bytes-zero',
        webSearch: false,
        projectIsolation: 'unknown',
      },
      {
        missingFeature: 'codex-ignore-web-search-config',
        feature: 'behavior:typed-config-web-search-live',
        webSearch: true,
        projectIsolation: 'isolated',
      },
      {
        missingFeature: 'codex-reject-web-search-config',
        feature: 'behavior:typed-config-web-search-live',
        webSearch: true,
        projectIsolation: 'isolated',
      },
    ] as const

    for (const testCase of cases) {
      const fixture = await createCodexBehaviorFixture(testCase.missingFeature)
      try {
        const adapter = new CodexCliAdapter()
        const options = {
          command: fixture.command,
          webSearch: testCase.webSearch,
        }
        const prepared = adapter.prepareOptions(options)
        const descriptor = adapter.inspect(prepared)
        assert.equal(descriptor.features.contextIsolation.projectInstructions, 'unknown')
        assert.equal(descriptor.capabilities.includes('web'), testCase.webSearch)

        const probe = await adapter.probe(prepared, { cwd: process.cwd() })
        assert.equal(probe.featureChecks['flag:-c'], true, testCase.missingFeature)
        assert.equal(probe.featureChecks[testCase.feature], false, testCase.missingFeature)
        assert.equal(probe.available, false, testCase.missingFeature)

        const admission = adapter.admit(role, task, prepared, probe)
        assert.equal(admission.allowed, false, testCase.missingFeature)
        assert.equal(
          admission.effectiveCapabilities.includes('web'),
          false,
          testCase.missingFeature,
        )
        assert.equal(
          admission.contextIsolation.projectInstructions,
          testCase.projectIsolation,
          testCase.missingFeature,
        )
        if (testCase.projectIsolation === 'unknown') {
          assert.equal(admission.effectivePublicOptions.projectDocMaxBytes, 'unknown')
        }

        let executeCount = 0
        const counted = countingAdapter(adapter, () => {
          executeCount += 1
        })
        const result = await new Rolekit({ roles: [role], adapters: [counted] }).run(task, {
          executorId: counted.id,
          cwd: process.cwd(),
          adapterOptions: options,
          runId: `codex-${testCase.missingFeature}`,
        })
        assert.equal(result.status, 'blocked', testCase.missingFeature)
        assert.equal(executeCount, 0, testCase.missingFeature)
      } finally {
        await fixture.cleanup()
      }
    }
  })

  it('treats explicit Codex project-instruction inheritance as an opted-out isolation control', async () => {
    const adapter = new CodexCliAdapter()
    const prepared = adapter.prepareOptions({
      command: cliFixture,
      inheritProjectInstructions: true,
      environment: { ROLEKIT_FAKE_MISSING_FEATURE: 'codex-reject-project-doc-config' },
    })

    const descriptor = adapter.inspect(prepared)
    assert.equal(descriptor.features.contextIsolation.projectInstructions, 'inherited')
    const probe = await adapter.probe(prepared, { cwd: process.cwd() })
    assert.equal(probe.available, true, probe.diagnostic)
    assert.equal(
      Object.hasOwn(probe.featureChecks, 'behavior:typed-config-project-doc-max-bytes-zero'),
      false,
    )
    assert.equal(Object.hasOwn(probe.featureChecks, 'config:project_doc_max_bytes=0'), false)
    assert.equal(Object.hasOwn(probe.featureChecks, 'behavior:typed-config-web-search-live'), false)

    const admission = adapter.admit(role, task, prepared, probe)
    assert.equal(admission.allowed, true)
    assert.equal(admission.contextIsolation.projectInstructions, 'inherited')
    assert.equal(admission.effectivePublicOptions.projectDocMaxBytes, 'inherited')
  })
})

interface WorkflowStep {
  readonly name?: string
  readonly if?: string
  readonly run?: string
  readonly env?: Readonly<Record<string, unknown>>
  readonly 'continue-on-error'?: unknown
}

async function latestCompatibilitySteps(): Promise<readonly WorkflowStep[]> {
  const workflow = parseYaml(await readFile(resolve('.github', 'workflows', 'ci.yml'), 'utf8')) as {
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly WorkflowStep[] }>>
  }
  const steps = workflow.jobs?.['latest-compatibility']?.steps
  assert.ok(steps)
  return steps
}

function workflowStep(steps: readonly WorkflowStep[], name: string): WorkflowStep {
  const step = steps.find((candidate) => candidate.name === name)
  assert.ok(step, name)
  return step
}

describe('compatibility CI policy', () => {
  it('covers installable built-ins and aligns credentials with actual smoke steps', async () => {
    const workflow = await readFile(resolve('.github', 'workflows', 'ci.yml'), 'utf8')

    assert.match(workflow, /new PiCliAdapter\(\)/u)
    assert.match(workflow, /new PiRpcAdapter\(\)/u)
    assert.match(workflow, /new CodexCliAdapter\(\)/u)
    assert.match(workflow, /npm run smoke:pi/u)
    assert.match(workflow, /npm run smoke:codex/u)
    assert.match(workflow, /pi_configured/u)
    assert.match(workflow, /codex_configured/u)
    assert.doesNotMatch(workflow, /- name: Install latest public CLIs\n\s+if:/u)
    assert.doesNotMatch(workflow, /- name: Probe latest CLIs through production adapters\n\s+if:/u)
    assert.match(workflow, /Cursor.*(?:limitation|not automated|cannot be automated)/iu)
    assert.match(
      workflow,
      /if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/u,
    )
  })

  it('keeps no-smoke latest install/probe failures nonfatal but configured failures enforceable', async () => {
    const steps = await latestCompatibilitySteps()
    const expectedPolicy = ['$', "{{ steps.credentials.outputs.configured != 'true' }}"].join('')
    assert.equal(
      workflowStep(steps, 'Install latest public CLIs')['continue-on-error'],
      expectedPolicy,
    )
    assert.equal(
      workflowStep(steps, 'Probe latest CLIs through production adapters')['continue-on-error'],
      expectedPolicy,
    )

    const smokeSteps = steps.filter((step) => step.name?.startsWith('Run credentialed '))
    assert.ok(smokeSteps.length > 0)
    for (const step of smokeSteps) {
      assert.equal(Object.hasOwn(step, 'continue-on-error'), false, step.name)
    }
  })

  it('matches Pi providers to runnable minimal credential environments', async () => {
    const smokeModule = (await import('../../scripts/smoke-pi.ts')) as unknown as {
      readonly selectPiSmokeCredentials?: (
        provider: string | undefined,
        model: string | undefined,
        environment: Readonly<Record<string, string | undefined>>,
      ) => {
        readonly configured: boolean
        readonly provider?: string
        readonly credentialEnvironment: Readonly<Record<string, string>>
        readonly diagnostic?: string
      }
    }
    assert.equal(typeof smokeModule.selectPiSmokeCredentials, 'function')
    const select = smokeModule.selectPiSmokeCredentials as NonNullable<
      typeof smokeModule.selectPiSmokeCredentials
    >
    const allCredentials = {
      ANTHROPIC_API_KEY: 'anthropic-secret',
      OPENAI_API_KEY: 'openai-secret',
      OPENROUTER_API_KEY: 'openrouter-secret',
      XAI_API_KEY: 'xai-secret',
      GEMINI_API_KEY: 'gemini-secret',
      GOOGLE_API_KEY: 'ignored-google-secret',
      AZURE_OPENAI_API_KEY: 'unsupported-azure-secret',
      AWS_ACCESS_KEY_ID: 'aws-access',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      AWS_SESSION_TOKEN: 'aws-session',
    }

    assert.deepEqual(select('xai', 'grok-4.5', allCredentials), {
      configured: true,
      provider: 'xai',
      credentialEnvironment: { XAI_API_KEY: 'xai-secret' },
    })
    assert.deepEqual(select('google', 'gemini-test', allCredentials), {
      configured: true,
      provider: 'google',
      credentialEnvironment: { GEMINI_API_KEY: 'gemini-secret' },
    })
    assert.deepEqual(select('amazon-bedrock', 'bedrock-test', allCredentials), {
      configured: true,
      provider: 'amazon-bedrock',
      credentialEnvironment: {
        AWS_ACCESS_KEY_ID: 'aws-access',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        AWS_SESSION_TOKEN: 'aws-session',
      },
    })

    const mismatched = select('openai', 'gpt-test', { XAI_API_KEY: 'wrong-provider' })
    assert.equal(mismatched.configured, false)
    assert.deepEqual(mismatched.credentialEnvironment, {})
    assert.match(mismatched.diagnostic ?? '', /OPENAI_API_KEY/u)

    const unsupported = select('azure-openai-responses', 'azure-test', {
      AZURE_OPENAI_API_KEY: 'unsupported',
    })
    assert.equal(unsupported.configured, false)
    assert.deepEqual(unsupported.credentialEnvironment, {})
    assert.match(unsupported.diagnostic ?? '', /unsupported/iu)

    const wrongGoogleKey = select('google', 'gemini-test', {
      GOOGLE_API_KEY: 'not-supported-by-pi',
    })
    assert.equal(wrongGoogleKey.configured, false)
    assert.match(wrongGoogleKey.diagnostic ?? '', /GEMINI_API_KEY/u)

    const partialBedrock = select('amazon-bedrock', 'bedrock-test', {
      AWS_ACCESS_KEY_ID: 'partial',
    })
    assert.equal(partialBedrock.configured, false)
    assert.match(partialBedrock.diagnostic ?? '', /AWS_SECRET_ACCESS_KEY/u)

    const missingModel = select('xai', undefined, { XAI_API_KEY: 'xai-secret' })
    assert.equal(missingModel.configured, false)
    assert.match(missingModel.diagnostic ?? '', /model/iu)
  })

  it('passes only the selected Pi provider credentials to each smoke step', async () => {
    const steps = await latestCompatibilitySteps()
    const expected = new Map<string, readonly string[]>([
      ['Run credentialed Pi smoke for Anthropic', ['ANTHROPIC_API_KEY']],
      ['Run credentialed Pi smoke for OpenAI', ['OPENAI_API_KEY']],
      ['Run credentialed Pi smoke for OpenRouter', ['OPENROUTER_API_KEY']],
      ['Run credentialed Pi smoke for xAI', ['XAI_API_KEY']],
      ['Run credentialed Pi smoke for Google', ['GEMINI_API_KEY']],
      [
        'Run credentialed Pi smoke for Amazon Bedrock',
        ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'],
      ],
    ])
    const credentialKeys = new Set([
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'XAI_API_KEY',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'AZURE_OPENAI_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
    ])

    for (const [name, allowedCredentials] of expected) {
      const step = workflowStep(steps, name)
      assert.match(step.run ?? '', /npm run smoke:pi/u)
      const actualCredentials = Object.keys(step.env ?? {}).filter((key) => credentialKeys.has(key))
      assert.deepEqual(actualCredentials.sort(), [...allowedCredentials].sort(), name)
      assert.equal(Object.hasOwn(step, 'continue-on-error'), false, name)
    }
  })
})

describe('redacted protocol golden fixtures', () => {
  it('keeps every fixture minimal and free of prompts, credentials, and private paths', async () => {
    for (const adapter of ['pi', 'cursor', 'codex'] as const) {
      for (const name of [
        'success',
        'tool-call',
        'failure',
        'malformed-truncated',
        'identity-usage',
      ]) {
        const fixture = await protocolFixture(adapter, name)
        assert.ok(fixture.length > 0 && fixture.length < 4_096, `${adapter}/${name}`)
        assert.doesNotMatch(fixture, /\/Users\/|[A-Za-z]:\\|api[_-]?key|bearer\s|user prompt/iu)
        assert.doesNotMatch(fixture, new RegExp(Object.values(fixtureSecrets).join('|'), 'u'))
      }
    }
  })

  it('parses Pi success, tool, identity, usage, failure, and truncation fixtures', async () => {
    for (const name of ['success', 'tool-call']) {
      const parsed = parsePiStream(await protocolFixture('pi', name))
      assert.equal(parseExecutorPayload(parsed.text).status, 'completed')
    }
    const identity = parsePiStream(await protocolFixture('pi', 'identity-usage'))
    assert.equal(identity.provider, 'observed-provider')
    assert.equal(identity.model, 'observed-provider/observed-model')
    assert.deepEqual(identity.usage, {
      inputTokens: 13,
      outputTokens: 8,
      totalTokens: 21,
      costUsd: 0.02,
    })
    await assert.rejects(
      async () => parsePiStream(await protocolFixture('pi', 'failure')),
      /final assistant message/u,
    )
    await assert.rejects(
      async () => parsePiStream(await protocolFixture('pi', 'malformed-truncated')),
      /final assistant message/u,
    )
  })

  it('parses Cursor success, tool, identity, usage, failure, and truncation fixtures', async () => {
    for (const name of ['success', 'tool-call']) {
      const parsed = parseCursorStream(await protocolFixture('cursor', name))
      assert.equal(parseExecutorPayload(parsed.finalText).status, 'completed')
    }
    const identity = parseCursorStream(await protocolFixture('cursor', 'identity-usage'))
    assert.equal(identity.model, 'observed-model')
    assert.deepEqual(identity.usage, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      durationMs: 12,
    })
    await assert.rejects(
      async () => parseCursorStream(await protocolFixture('cursor', 'failure')),
      /terminal result/u,
    )
    await assert.rejects(
      async () => parseCursorStream(await protocolFixture('cursor', 'malformed-truncated')),
      /terminal result/u,
    )
  })

  it('parses every Codex terminal fixture through production parser semantics', async () => {
    assert.deepEqual(parseCodexEvents(await protocolFixture('codex', 'success')), {
      terminal: 'completed',
      usage: { inputTokens: 5, outputTokens: 3, cachedInputTokens: 1 },
    })
    assert.deepEqual(parseCodexEvents(await protocolFixture('codex', 'tool-call')), {
      terminal: 'completed',
      usage: { inputTokens: 7, outputTokens: 4 },
    })
    const identity = parseCodexEvents(await protocolFixture('codex', 'identity-usage'))
    assert.deepEqual(identity, {
      terminal: 'completed',
      usage: { inputTokens: 12, outputTokens: 7, cachedInputTokens: 4 },
    })
    assert.equal(Object.hasOwn(identity, 'model'), false)
    await assert.rejects(
      async () => parseCodexEvents(await protocolFixture('codex', 'failure')),
      /turn\.failed|terminal failure/iu,
    )
    await assert.rejects(
      async () => parseCodexEvents(await protocolFixture('codex', 'malformed-truncated')),
      /terminal completion|truncated/iu,
    )
  })

  it('runs every Codex fixture through adapter response and receipt finalization', async () => {
    for (const [name, expectedStatus] of [
      ['success', 'completed'],
      ['tool-call', 'completed'],
      ['identity-usage', 'completed'],
      ['failure', 'failed'],
      ['malformed-truncated', 'failed'],
    ] as const) {
      const eventsPath = resolve('test', 'fixtures', 'protocol', 'codex', `${name}.jsonl`)
      const result = await new Rolekit({ roles: [role], adapters: [new CodexCliAdapter()] }).run(
        task,
        {
          executorId: 'codex',
          cwd: process.cwd(),
          adapterOptions: {
            command: cliFixture,
            model: 'auto',
            environment: { ROLEKIT_FAKE_CODEX_EVENTS_PATH: eventsPath },
          },
          runId: `codex-golden-${name}`,
        },
      )
      assert.equal(result.status, expectedStatus, name)
      assert.equal(result.executor.requestedModel, 'auto', name)
      assert.equal(result.executor.actualProvider, undefined, name)
      assert.equal(result.executor.actualModel, undefined, name)
      assert.equal(Object.isFrozen(result), true, name)
    }
  })
})

describe('requested and observed executor identity separation', () => {
  it('keeps requested aliases separate from a deliberately different observed Pi identity', async () => {
    const result = await new Rolekit({ roles: [role], adapters: [new PiCliAdapter()] }).run(task, {
      executorId: 'pi',
      cwd: process.cwd(),
      adapterOptions: {
        command: cliFixture,
        provider: 'requested-provider',
        model: 'auto',
        tools: ['read'],
      },
      runId: 'pi-requested-versus-observed',
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.executor.requestedProvider, 'requested-provider')
    assert.equal(result.executor.requestedModel, 'auto')
    assert.equal(result.executor.actualProvider, 'fixture')
    assert.equal(result.executor.actualModel, 'fixture/pi-model')
    assert.notEqual(result.executor.actualProvider, result.executor.requestedProvider)
    assert.notEqual(result.executor.actualModel, result.executor.requestedModel)
    assert.equal(Object.isFrozen(result), true)
    assert.equal(Object.isFrozen(result.executor), true)
  })

  it('keeps actual provider and model absent for a silent Codex protocol', async () => {
    const eventsPath = resolve('test', 'fixtures', 'protocol', 'codex', 'identity-usage.jsonl')
    const result = await new Rolekit({ roles: [role], adapters: [new CodexCliAdapter()] }).run(
      task,
      {
        executorId: 'codex',
        cwd: process.cwd(),
        adapterOptions: {
          command: cliFixture,
          model: 'auto',
          environment: { ROLEKIT_FAKE_CODEX_EVENTS_PATH: eventsPath },
        },
        runId: 'codex-requested-silent-observed',
      },
    )

    assert.equal(result.status, 'completed')
    assert.equal(result.executor.requestedModel, 'auto')
    assert.equal(result.executor.actualProvider, undefined)
    assert.equal(result.executor.actualModel, undefined)
    assert.equal(Object.isFrozen(result.executor), true)
  })
})
