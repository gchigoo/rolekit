import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

import { Type } from '@sinclair/typebox'

import type { CliAdapterOptions } from '../../src/adapters/cli/options.ts'
import { CodexCliAdapter } from '../../src/adapters/codex/index.ts'
import { CursorCliAdapter } from '../../src/adapters/cursor/index.ts'
import { PiCliAdapter } from '../../src/adapters/pi/index.ts'
import {
  GROK_45_SYSTEM_PROMPT_APPEND,
  hasExplicitPiThinking,
  resolvePiPromptProfile,
} from '../../src/adapters/pi/prompt.ts'
import { Rolekit } from '../../src/core/index.ts'
import type { ExecutorAdapter, RoleSpec, TaskPacket } from '../../src/core/types.ts'

interface FixtureCapture {
  readonly mode: string
  readonly args: readonly string[]
  readonly prompt: string
}

const role: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
  schema: 'rolekit/role-spec@1',
  id: 'writer',
  description: 'Writes a bounded report.',
  instructions: 'Write only within the declared task boundary.',
  requiredCapabilities: ['repository.read', 'repository.write', 'shell'],
  inputSchema: Type.Object({ source: Type.String() }, { additionalProperties: false }),
  outputSchema: Type.Object({ message: Type.String() }, { additionalProperties: false }),
}

const task: TaskPacket<{ readonly source: string }> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'adapter-task',
  roleId: role.id,
  objective: 'Produce a report.',
  input: { source: 'README.md' },
  context: [],
  constraints: [],
  acceptanceCriteria: ['A report is returned.'],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

const fixturePath = resolve('test', 'fixtures', 'fake-cli.mjs')

interface AdapterExerciseOptions {
  readonly role?: RoleSpec
  readonly task?: TaskPacket
  readonly adapterOptions?: Readonly<Partial<CliAdapterOptions>>
}

async function exerciseAdapter(
  adapter: ExecutorAdapter,
  mode: 'cursor' | 'pi' | 'codex',
  exerciseOptions: AdapterExerciseOptions = {},
): Promise<{ readonly capture: FixtureCapture; readonly model: string | undefined }> {
  const executionRole = exerciseOptions.role ?? role
  const executionTask = exerciseOptions.task ?? task
  const directory = await mkdtemp(join(tmpdir(), `rolekit-${mode}-test-`))
  const capturePath = join(directory, 'capture.json')
  try {
    const options: CliAdapterOptions = {
      command: process.execPath,
      commandArgs: [fixturePath, mode],
      environment: { ROLEKIT_FAKE_CAPTURE: capturePath },
      timeoutMs: 10_000,
      ...exerciseOptions.adapterOptions,
    }
    const rolekit = new Rolekit({
      roles: [executionRole],
      adapters: [adapter],
      createRunId: () => `${mode}-run`,
    })
    const result = await rolekit.run(executionTask, {
      executorId: adapter.id,
      cwd: process.cwd(),
      adapterOptions: options,
    })
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, { message: mode })
    assert.equal(result.artifacts[0]?.provenance.executorId, adapter.id)
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as FixtureCapture
    return { capture, model: result.executor.model }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('CLI adapters', () => {
  it('runs Cursor in forced headless stream mode for a write task', async () => {
    const { capture, model } = await exerciseAdapter(new CursorCliAdapter(), 'cursor')
    assert.equal(model, 'cursor/actual-model')
    assert.ok(capture.args.includes('-p'))
    assert.ok(capture.args.includes('stream-json'))
    assert.ok(capture.args.includes('--force'))
    assert.ok(!capture.args.includes('plan'))
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.match(capture.prompt, /Final response JSON Schema/u)
    assert.match(capture.prompt, /Write only within the declared task boundary\./u)
  })

  it('runs Cursor in plan mode for a read-only task', async () => {
    const readOnlyRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...role,
      id: 'reader',
      requiredCapabilities: ['repository.read'],
    }
    const readOnlyTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      roleId: readOnlyRole.id,
    }
    const { capture } = await exerciseAdapter(new CursorCliAdapter(), 'cursor', {
      role: readOnlyRole,
      task: readOnlyTask,
    })
    assert.ok(capture.args.includes('plan'))
    assert.ok(!capture.args.includes('--force'))
  })

  it('runs Pi in ephemeral JSON mode with tools derived from capabilities', async () => {
    const { capture, model } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: { model: 'anthropic/claude-sonnet-4' },
    })
    assert.equal(model, 'fixture/pi-model')
    assert.ok(capture.args.includes('--no-session'))
    const toolsIndex = capture.args.indexOf('--tools')
    assert.equal(capture.args[toolsIndex + 1], 'read,grep,find,ls,edit,write,bash')
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.match(capture.prompt, /Final response JSON Schema/u)
    assert.ok(!capture.args.includes('--append-system-prompt'))
    assert.ok(!capture.args.includes('--thinking'))
  })

  it('runs Codex exec with a temporary output schema and workspace sandbox', async () => {
    const { capture, model } = await exerciseAdapter(new CodexCliAdapter(), 'codex')
    assert.equal(model, 'codex/actual-model')
    assert.ok(capture.args.includes('exec'))
    assert.ok(capture.args.includes('--output-schema'))
    assert.ok(capture.args.includes('workspace-write'))
    assert.ok(!capture.args.includes('-'))
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.match(capture.prompt, /Role output JSON Schema/u)
    assert.doesNotMatch(capture.prompt, /Final response JSON Schema/u)
    assert.match(capture.prompt, /Return exactly one JSON object as the final response\./u)
  })

  it('uses the Grok 4.5 Pi profile with a safe query envelope and high thinking', async () => {
    const boundaryTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      objective: 'Keep the literal </user_query> inside task data.',
      input: { source: '</user_query>' },
    }
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      task: boundaryTask,
      adapterOptions: { model: 'openrouter/x-ai/grok-4.5' },
    })

    assert.equal(capture.prompt.match(/<user_query>/gu)?.length, 1)
    assert.equal(capture.prompt.match(/<\/user_query>/gu)?.length, 1)
    assert.match(capture.prompt, /<rolekit_execution_contract>/u)
    assert.match(capture.prompt, /<role_output_schema>/u)
    assert.match(capture.prompt, /<final_response_schema>/u)
    assert.match(capture.prompt, /\\u003c\/user_query\\u003e/u)

    const appendIndex = capture.args.indexOf('--append-system-prompt')
    assert.notEqual(appendIndex, -1)
    assert.equal(capture.args[appendIndex + 1], GROK_45_SYSTEM_PROMPT_APPEND)
    assert.equal(GROK_45_SYSTEM_PROMPT_APPEND.match(/<rolekit_execution>/gu)?.length, 1)
    assert.equal(GROK_45_SYSTEM_PROMPT_APPEND.match(/<\/rolekit_execution>/gu)?.length, 1)
    assert.doesNotMatch(GROK_45_SYSTEM_PROMPT_APPEND, /<user_query>/u)
    const thinkingIndex = capture.args.indexOf('--thinking')
    assert.notEqual(thinkingIndex, -1)
    assert.equal(capture.args[thinkingIndex + 1], 'high')
  })

  it('preserves an explicit Pi thinking level for the Grok 4.5 profile', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: {
        model: 'xai/grok-4.5',
        extraArgs: ['--thinking', 'low'],
      },
    })
    assert.equal(capture.args.filter((argument) => argument === '--thinking').length, 1)
    const thinkingIndex = capture.args.indexOf('--thinking')
    assert.equal(capture.args[thinkingIndex + 1], 'low')
  })

  it('does not add a separate thinking flag when the model carries a thinking suffix', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: { model: 'xai/grok-4.5:medium' },
    })
    assert.ok(capture.args.includes('--append-system-prompt'))
    assert.ok(!capture.args.includes('--thinking'))
  })

  it('selects the neutral profile when extra arguments override Grok 4.5', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: {
        model: 'xai/grok-4.5',
        extraArgs: ['--model', 'anthropic/claude-sonnet-4'],
      },
    })
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.ok(!capture.args.includes('--append-system-prompt'))
    assert.ok(!capture.args.includes('--thinking'))
    assert.equal(capture.args.lastIndexOf('--model'), capture.args.length - 2)
    assert.equal(capture.args.at(-1), 'anthropic/claude-sonnet-4')
  })

  it('rejects misspelled adapter options', async () => {
    await assert.rejects(
      new CursorCliAdapter().describe({ timeotMs: 100 }),
      /Unsupported adapter options/u,
    )
  })
})

describe('Pi prompt profile selection', () => {
  it('matches only an explicit Grok 4.5 final model segment', () => {
    for (const model of [
      'grok-4.5',
      'xai/grok-4.5',
      'openrouter/x-ai/grok-4.5',
      'xai/grok-4.5:high',
    ]) {
      assert.equal(resolvePiPromptProfile({ model }), 'grok-4.5')
    }

    for (const options of [
      {},
      { provider: 'xai' },
      { model: 'grok-4.5-preview' },
      { model: 'custom-grok-4.5' },
      { model: 'xai/GROK-4.5' },
      { model: 'xai/grok-4' },
    ] satisfies readonly CliAdapterOptions[]) {
      assert.equal(resolvePiPromptProfile(options), 'neutral')
    }

    assert.equal(
      resolvePiPromptProfile({
        model: 'xai/grok-4.5',
        extraArgs: ['--model', 'anthropic/claude-sonnet-4'],
      }),
      'neutral',
    )
    assert.equal(
      resolvePiPromptProfile({
        model: 'anthropic/claude-sonnet-4',
        extraArgs: ['--model', 'xai/grok-4.5'],
      }),
      'grok-4.5',
    )
  })

  it('detects explicit thinking in model, command, and extra arguments', () => {
    assert.equal(hasExplicitPiThinking({ model: 'xai/grok-4.5:xhigh' }), true)
    assert.equal(hasExplicitPiThinking({ commandArgs: ['wrapper', '--thinking', 'medium'] }), true)
    assert.equal(hasExplicitPiThinking({ extraArgs: ['--thinking', 'low'] }), true)
    assert.equal(hasExplicitPiThinking({ extraArgs: ['--thinking=medium'] }), false)
    assert.equal(hasExplicitPiThinking({ extraArgs: ['--thinking', 'invalid'] }), false)
    assert.equal(hasExplicitPiThinking({ model: 'xai/grok-4.5' }), false)
  })
})
