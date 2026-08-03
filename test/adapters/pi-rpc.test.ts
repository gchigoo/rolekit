import assert from 'node:assert/strict'
import { access, chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

import { Type } from '@sinclair/typebox'

import { PiRpcAdapter } from '../../src/adapters/pi-rpc/index.ts'
import { Rolekit } from '../../src/core/index.ts'
import type { RoleSpec, RunEvent, TaskPacket } from '../../src/core/types.ts'

const fixturePath = resolve('test', 'fixtures', 'fake-pi-rpc.mjs')

const role: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
  schema: 'rolekit/role-spec@1',
  id: 'rpc-reviewer',
  description: 'Reviews one bounded file.',
  requiredCapabilities: ['repository.read'],
  inputSchema: Type.Object({ source: Type.String() }, { additionalProperties: false }),
  outputSchema: Type.Object({ message: Type.String() }, { additionalProperties: false }),
}

const task: TaskPacket<{ readonly source: string }> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'rpc-task',
  roleId: role.id,
  objective: 'Review the requested file.',
  input: { source: 'README.md' },
  context: [],
  constraints: ['Do not modify files.'],
  acceptanceCriteria: ['Return one report.'],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

interface CapturedRecord {
  readonly phase: string
  readonly rpcOrdinal?: number
  readonly args?: readonly string[]
  readonly command?: Readonly<Record<string, unknown>>
  readonly environment?: Readonly<Record<string, string | null>>
}

async function captureRecords(path: string): Promise<readonly CapturedRecord[]> {
  const content = await readFile(path, 'utf8')
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CapturedRecord)
}

async function waitForCapturedCommand(
  path: string,
  type: string,
  occurrence = 1,
  rpcOrdinal = 2,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const records = await captureRecords(path)
      const count = records.filter(
        (record) =>
          record.phase === 'command' &&
          record.rpcOrdinal === rpcOrdinal &&
          record.command?.type === type,
      ).length
      if (count >= occurrence) {
        return
      }
    } catch {
      // The capture file is created by the fixture process.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(
    `Timed out waiting for Pi RPC command ${type} occurrence ${occurrence} in process ${rpcOrdinal}.`,
  )
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    } catch {
      return
    }
  }
  throw new Error(`Process ${pid} did not exit within ${timeoutMs} ms.`)
}

async function withFixture<T>(
  run: (fixture: {
    readonly directory: string
    readonly capturePath: string
    readonly childPidPath: string
  }) => Promise<T>,
): Promise<T> {
  await chmod(fixturePath, 0o755)
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-pi-rpc-'))
  const capturePath = join(directory, 'capture.jsonl')
  const childPidPath = join(directory, 'child.pid')
  try {
    return await run({ directory, capturePath, childPidPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function createRuntime() {
  return new Rolekit({
    roles: [role],
    adapters: [new PiRpcAdapter()],
    createRunId: () => 'pi-rpc-run',
    now: () => new Date('2026-07-31T12:00:00.000Z'),
  })
}

describe('Pi RPC adapter', () => {
  it('emits ordered portable events before returning the terminal result', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const events: RunEvent[] = []
      const result = await createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          tools: ['read'],
          environment: { ROLEKIT_FAKE_RPC_CAPTURE: capturePath },
        },
        onEvent: (event) => events.push(event),
      })

      assert.equal(result.status, 'completed')
      assert.deepEqual(
        events.map((event) => event.sequence),
        [1, 2, 3, 4, 5],
      )
      assert.deepEqual(
        events.map((event) => event.type),
        ['lifecycle', 'assistant.delta', 'tool.started', 'tool.completed', 'lifecycle'],
      )
      assert.equal(events[0]?.type === 'lifecycle' ? events[0].phase : undefined, 'started')
      const terminalEvent = events.at(-1)
      assert.equal(
        terminalEvent?.type === 'lifecycle' ? terminalEvent.phase : undefined,
        'completed',
      )
      assert.ok(events.some((event) => event.type === 'tool.started'))
      assert.ok(
        events.every(
          (event) => event.runId === 'pi-rpc-run' && event.createdAt === '2026-07-31T12:00:00.000Z',
        ),
      )
    })
  })

  it('configures the requested Pi provider model thinking and tools through RPC/CLI startup', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const secret = 'pi-rpc-runtime-secret'
      const result = await createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          provider: 'xai',
          model: 'grok-4.5',
          thinking: 'xhigh',
          tools: ['read', 'grep'],
          extensions: ['./extension.ts'],
          skills: ['./skill'],
          promptTemplates: ['./prompt.md'],
          offline: true,
          environment: {
            XAI_API_KEY: secret,
            ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
          },
        },
      })

      assert.equal(result.status, 'completed')
      assert.equal(result.executor.requestedProvider, 'xai')
      assert.equal(result.executor.requestedModel, 'grok-4.5')
      assert.equal(result.executor.actualProvider, 'xai')
      assert.equal(result.executor.actualModel, 'grok-4.5')

      const records = await captureRecords(capturePath)
      const startups = records.filter((record) => record.phase === 'startup')
      assert.ok(startups.length >= 2)
      const executionStartup = startups.at(-1)
      assert.ok(executionStartup?.args?.includes('--mode'))
      assert.ok(executionStartup?.args?.includes('rpc'))
      assert.ok(executionStartup?.args?.includes('--no-session'))
      assert.ok(executionStartup?.args?.includes('--no-context-files'))
      assert.ok(executionStartup?.args?.includes('--no-extensions'))
      assert.ok(executionStartup?.args?.includes('--no-skills'))
      assert.ok(executionStartup?.args?.includes('--no-prompt-templates'))
      assert.ok(executionStartup?.args?.includes('--offline'))
      const toolsIndex = executionStartup?.args?.indexOf('--tools') ?? -1
      assert.equal(executionStartup?.args?.[toolsIndex + 1], 'read,grep')
      assert.equal(executionStartup?.environment?.XAI_API_KEY, secret)
      assert.notEqual(executionStartup?.environment?.PI_CODING_AGENT_DIR, null)
      assert.equal(
        executionStartup?.environment?.PI_CODING_AGENT_DIR,
        executionStartup?.environment?.HOME,
      )

      const commands = records
        .filter((record) => record.phase === 'command')
        .map((record) => record.command)
      assert.ok(
        commands.some(
          (command) =>
            command?.type === 'set_model' &&
            command.provider === 'xai' &&
            command.modelId === 'grok-4.5',
        ),
      )
      assert.ok(
        commands.some(
          (command) => command?.type === 'set_thinking_level' && command.level === 'xhigh',
        ),
      )
      assert.ok(commands.some((command) => command?.type === 'prompt'))
      assert.doesNotMatch(
        JSON.stringify(records.map((record) => ({ args: record.args, command: record.command }))),
        new RegExp(secret, 'u'),
      )
    })
  })

  it('rejects non-fresh or persisted initial state before setup or prompting', async () => {
    for (const mode of ['stale-messages', 'stale-pending', 'persisted-session'] as const) {
      await withFixture(async ({ directory, capturePath }) => {
        const result = await createRuntime().run(task, {
          executorId: 'pi-rpc',
          cwd: directory,
          adapterOptions: {
            command: fixturePath,
            provider: 'xai',
            model: 'grok-4.5',
            thinking: 'high',
            tools: ['read'],
            environment: {
              ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
              ROLEKIT_FAKE_RPC_MODE: mode,
            },
          },
        })

        assert.equal(result.status, 'blocked', mode)
        assert.equal(result.error.code, 'executor_unavailable', mode)
        assert.match(result.error.message, /fresh|session|message|pending/iu, mode)
        const commands = (await captureRecords(capturePath)).filter(
          (record) => record.phase === 'command' && record.rpcOrdinal === 1,
        )
        assert.deepEqual(
          commands.map((record) => record.command?.type),
          ['get_state'],
          mode,
        )
      })
    }
  })

  it('reports probe command checks only after successful correlated exercise', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const adapter = new PiRpcAdapter()
      const prepared = adapter.prepareOptions({
        command: fixturePath,
        tools: ['read'],
        environment: {
          ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
          ROLEKIT_FAKE_RPC_MODE: 'probe-insufficient-model',
        },
      })
      const probe = await adapter.probe(prepared, { cwd: directory })

      assert.equal(probe.available, true)
      assert.equal(probe.featureChecks['rpc:get_state'], true)
      assert.equal(probe.featureChecks['rpc:set_model'], false)
      assert.equal(probe.featureChecks['rpc:set_thinking_level'], true)
      assert.equal(probe.featureChecks['rpc:abort'], true)
      assert.equal(probe.featureChecks['rpc:request_correlation'], true)
      const commands = await captureRecords(capturePath)
      assert.equal(
        commands.some(
          (record) => record.phase === 'command' && record.command?.type === 'set_model',
        ),
        false,
      )
    })

    await withFixture(async ({ directory, capturePath }) => {
      const adapter = new PiRpcAdapter()
      const prepared = adapter.prepareOptions({
        command: fixturePath,
        provider: 'xai',
        model: 'grok-4.5',
        tools: ['read'],
        environment: {
          ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
          ROLEKIT_FAKE_RPC_MODE: 'probe-null-model-configured',
        },
      })
      const probe = await adapter.probe(prepared, { cwd: directory })

      assert.equal(probe.available, true)
      assert.equal(probe.featureChecks['rpc:set_model'], true)
      const commands = await captureRecords(capturePath)
      assert.ok(
        commands.some(
          (record) =>
            record.phase === 'command' &&
            record.command?.type === 'set_model' &&
            record.command.provider === 'xai' &&
            record.command.modelId === 'grok-4.5',
        ),
      )
    })

    await withFixture(async ({ directory, capturePath }) => {
      const adapter = new PiRpcAdapter()
      const prepared = adapter.prepareOptions({
        command: fixturePath,
        provider: 'xai',
        model: 'grok-4.5',
        tools: ['read'],
        environment: {
          ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
          ROLEKIT_FAKE_RPC_MODE: 'probe-set-model-failure',
        },
      })
      const probe = await adapter.probe(prepared, { cwd: directory })

      assert.equal(probe.available, false)
      assert.equal(probe.featureChecks['rpc:get_state'], true)
      assert.equal(probe.featureChecks['rpc:set_model'], false)
      assert.equal(probe.featureChecks['rpc:request_correlation'], true)
      assert.match(probe.diagnostic ?? '', /set_model|failed/iu)
    })
  })

  it('translates documented usage without conflating requested and observed identity', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const events: RunEvent[] = []
      const result = await createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          provider: 'requested-provider',
          model: 'requested-model',
          tools: ['read'],
          environment: {
            ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
            ROLEKIT_FAKE_RPC_MODE: 'fixture-usage-observed-mode',
          },
        },
        onEvent: (event) => events.push(event),
      })

      assert.equal(result.status, 'completed')
      assert.equal(result.executor.requestedProvider, 'requested-provider')
      assert.equal(result.executor.requestedModel, 'requested-model')
      assert.equal(result.executor.actualProvider, 'observed-provider')
      assert.equal(result.executor.actualModel, 'observed-model')
      assert.deepEqual(
        events.find((event) => event.type === 'usage'),
        {
          type: 'usage',
          usage: {
            inputTokens: 13,
            outputTokens: 8,
            totalTokens: 23,
            cachedInputTokens: 2,
            costUsd: 0.02,
          },
          runId: 'pi-rpc-run',
          sequence: 5,
          createdAt: '2026-07-31T12:00:00.000Z',
        },
      )
    })
  })

  it('sends abort and terminates the Pi process tree when the RoleKit signal is cancelled', {
    skip: process.platform === 'win32',
  }, async () => {
    await withFixture(async ({ directory, capturePath, childPidPath }) => {
      const controller = new AbortController()
      const resultPromise = createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          timeoutMs: 10_000,
          tools: ['read'],
          environment: {
            ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
            ROLEKIT_FAKE_RPC_MODE: 'hang',
            ROLEKIT_FAKE_RPC_CHILD_PID: childPidPath,
          },
        },
        signal: controller.signal,
      })

      await waitForFile(childPidPath)
      const childPid = Number.parseInt(await readFile(childPidPath, 'utf8'), 10)
      const cancelledAt = Date.now()
      controller.abort()
      const result = await resultPromise

      assert.equal(result.status, 'cancelled')
      assert.equal(result.error.code, 'cancelled')
      assert.ok(Date.now() - cancelledAt < 5_000)
      const records = await captureRecords(capturePath)
      assert.ok(
        records.some((record) => record.phase === 'command' && record.command?.type === 'abort'),
      )
      await waitForProcessExit(childPid)
    })
  })

  it('cancels during startup, setup, prompt acknowledgement, and final-state inspection', async () => {
    const cases = [
      { mode: 'cancel-initial-state', command: 'get_state', occurrence: 1 },
      { mode: 'cancel-model-setup', command: 'set_model', occurrence: 1 },
      { mode: 'cancel-thinking-setup', command: 'set_thinking_level', occurrence: 1 },
      { mode: 'cancel-prompt-ack', command: 'prompt', occurrence: 1 },
      { mode: 'cancel-final-state', command: 'get_state', occurrence: 2 },
    ] as const

    for (const testCase of cases) {
      await withFixture(async ({ directory, capturePath }) => {
        const controller = new AbortController()
        const resultPromise = createRuntime().run(task, {
          executorId: 'pi-rpc',
          cwd: directory,
          adapterOptions: {
            command: fixturePath,
            provider: 'xai',
            model: 'grok-4.5',
            thinking: 'high',
            timeoutMs: 10_000,
            tools: ['read'],
            environment: {
              ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
              ROLEKIT_FAKE_RPC_MODE: testCase.mode,
            },
          },
          signal: controller.signal,
        })

        await waitForCapturedCommand(capturePath, testCase.command, testCase.occurrence, 2)
        const cancelledAt = Date.now()
        controller.abort()
        const result = await resultPromise

        assert.equal(result.status, 'cancelled', testCase.mode)
        assert.equal(result.error.code, 'cancelled', testCase.mode)
        assert.ok(Date.now() - cancelledAt < 5_000, testCase.mode)
        const records = await captureRecords(capturePath)
        assert.ok(
          records.some(
            (record) =>
              record.phase === 'command' &&
              record.rpcOrdinal === 2 &&
              record.command?.type === 'abort',
          ),
          testCase.mode,
        )
      })
    }
  })

  it('rejects malformed JSONL and missing terminal agent events as protocol errors', async () => {
    for (const mode of ['malformed', 'missing-terminal'] as const) {
      await withFixture(async ({ directory, capturePath }) => {
        const result = await createRuntime().run(task, {
          executorId: 'pi-rpc',
          cwd: directory,
          adapterOptions: {
            command: fixturePath,
            timeoutMs: 2_000,
            tools: ['read'],
            environment: {
              ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
              ROLEKIT_FAKE_RPC_MODE: mode,
            },
          },
        })

        assert.equal(result.status, 'failed', mode)
        assert.equal(result.error.code, 'protocol_error', mode)
        assert.doesNotMatch(result.error.message, /adapter execution failed/iu)
      })
    }
  })

  it('rejects unknown, malformed, and documented terminal failure events', async () => {
    const cases = [
      { mode: 'unknown-event', pattern: /event.*unsupported|unsupported.*event/iu },
      { mode: 'malformed-event', pattern: /malformed/iu },
      { mode: 'unknown-assistant-update', pattern: /assistant.*event|unsupported/iu },
      { mode: 'settled-with-error', pattern: /agent_settled.*field|unsupported/iu },
      { mode: 'auto-retry-started', pattern: /retry/iu },
      { mode: 'auto-retry-failed', pattern: /retry/iu },
      { mode: 'summarization-retry', pattern: /summarization.*retry/iu },
      { mode: 'queued-work', pattern: /queued.*steering|follow-up/iu },
      { mode: 'compaction-aborted', pattern: /compaction|aborted/iu },
      { mode: 'extension-error', pattern: /extension/iu },
    ] as const

    for (const testCase of cases) {
      await withFixture(async ({ directory, capturePath }) => {
        const result = await createRuntime().run(task, {
          executorId: 'pi-rpc',
          cwd: directory,
          adapterOptions: {
            command: fixturePath,
            timeoutMs: 2_000,
            tools: ['read'],
            environment: {
              ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
              ROLEKIT_FAKE_RPC_MODE: testCase.mode,
            },
          },
        })

        assert.equal(result.status, 'failed', testCase.mode)
        assert.equal(result.error.code, 'protocol_error', testCase.mode)
        assert.match(result.error.message, testCase.pattern, testCase.mode)
      })
    }
  })

  for (const testCase of [
    { type: 'start', missing: 'partial' },
    { type: 'text_start', missing: 'partial' },
    { type: 'text_delta', missing: 'partial' },
    { type: 'text_end', missing: 'content' },
    { type: 'thinking_start', missing: 'partial' },
    { type: 'thinking_delta', missing: 'partial' },
    { type: 'thinking_end', missing: 'content' },
    { type: 'toolcall_start', missing: 'partial' },
    { type: 'toolcall_delta', missing: 'partial' },
    { type: 'toolcall_end', missing: 'toolCall' },
    { type: 'done', missing: 'message' },
    { type: 'error', missing: 'error' },
  ] as const) {
    it(`rejects ${testCase.type} without its documented ${testCase.missing} payload`, async () => {
      await withFixture(async ({ directory, capturePath }) => {
        const result = await createRuntime().run(task, {
          executorId: 'pi-rpc',
          cwd: directory,
          adapterOptions: {
            command: fixturePath,
            timeoutMs: 2_000,
            tools: ['read'],
            environment: {
              ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
              ROLEKIT_FAKE_RPC_MODE: `missing-assistant-event-payload-${testCase.type}`,
            },
          },
        })

        assert.equal(result.status, 'failed')
        assert.equal(result.error.code, 'protocol_error')
        assert.match(
          result.error.message,
          new RegExp(`${testCase.type}.*${testCase.missing}.*malformed`, 'iu'),
        )
      })
    })
  }

  it('accepts a tool-call-only assistant turn before the final textual JSON message', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const events: RunEvent[] = []
      const result = await createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          tools: ['read'],
          environment: {
            ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
            ROLEKIT_FAKE_RPC_MODE: 'tool-call-only-turn',
          },
        },
        onEvent: (event) => events.push(event),
      })

      assert.equal(result.status, 'completed')
      assert.deepEqual(result.output, { message: 'pi-rpc' })
      assert.equal(events.filter((event) => event.type === 'assistant.delta').length, 1)
      assert.ok(events.some((event) => event.type === 'tool.started'))
      assert.ok(events.some((event) => event.type === 'tool.completed'))
    })
  })

  it('emits usage from a valid non-text assistant turn before final textual JSON', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const events: RunEvent[] = []
      const result = await createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          tools: ['read'],
          environment: {
            ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
            ROLEKIT_FAKE_RPC_MODE: 'non-text-usage',
          },
        },
        onEvent: (event) => events.push(event),
      })

      assert.equal(result.status, 'completed')
      assert.deepEqual(result.output, { message: 'pi-rpc' })
      assert.deepEqual(
        events.filter((event) => event.type === 'usage').map((event) => event.usage),
        [
          {
            inputTokens: 21,
            outputTokens: 5,
            totalTokens: 29,
            cachedInputTokens: 3,
            costUsd: 0.03,
          },
        ],
      )
    })
  })

  for (const stopReason of ['error', 'aborted'] as const) {
    it(`fails on a non-text assistant ${stopReason} stop before final textual JSON`, async () => {
      await withFixture(async ({ directory, capturePath }) => {
        const events: RunEvent[] = []
        const result = await createRuntime().run(task, {
          executorId: 'pi-rpc',
          cwd: directory,
          adapterOptions: {
            command: fixturePath,
            tools: ['read'],
            environment: {
              ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
              ROLEKIT_FAKE_RPC_MODE: `non-text-terminal-${stopReason}`,
            },
          },
          onEvent: (event) => events.push(event),
        })

        assert.equal(result.status, 'failed')
        assert.equal(result.error.code, 'protocol_error')
        assert.match(result.error.message, new RegExp(`non-text.*${stopReason}`, 'iu'))
        assert.ok(
          events.some(
            (event) =>
              event.type === 'diagnostic' &&
              event.level === 'error' &&
              new RegExp(`non-text.*${stopReason}`, 'iu').test(event.message),
          ),
        )
      })
    })
  }

  it('accepts documented benign event records without treating them as workflow ownership', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const result = await createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          tools: ['read'],
          environment: {
            ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
            ROLEKIT_FAKE_RPC_MODE: 'benign-events',
          },
        },
      })

      assert.equal(result.status, 'completed')
    })
  })

  it('redacts terminal diagnostics before exposing events or results', async () => {
    await withFixture(async ({ directory, capturePath }) => {
      const secret = 'terminal-event-secret'
      const events: RunEvent[] = []
      const result = await createRuntime().run(task, {
        executorId: 'pi-rpc',
        cwd: directory,
        adapterOptions: {
          command: fixturePath,
          tools: ['read'],
          environment: {
            XAI_API_KEY: secret,
            ROLEKIT_FAKE_RPC_CAPTURE: capturePath,
            ROLEKIT_FAKE_RPC_MODE: 'terminal-error',
          },
        },
        onEvent: (event) => events.push(event),
      })

      assert.equal(result.status, 'failed')
      const surface = JSON.stringify({ result, events })
      assert.doesNotMatch(surface, new RegExp(secret, 'u'))
      assert.match(surface, /\[REDACTED\]/u)
      assert.ok(events.some((event) => event.type === 'diagnostic' && event.level === 'error'))
    })
  })
})
