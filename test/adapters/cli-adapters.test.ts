import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

import { Type } from '@sinclair/typebox'

import { CodexCliAdapter } from '../../src/adapters/codex/index.ts'
import { CursorCliAdapter } from '../../src/adapters/cursor/index.ts'
import { PiCliAdapter } from '../../src/adapters/pi/index.ts'
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

async function exerciseAdapter(
  adapter: ExecutorAdapter,
  mode: 'cursor' | 'pi' | 'codex',
  executionRole: RoleSpec = role,
  executionTask: TaskPacket = task,
): Promise<{ readonly capture: FixtureCapture; readonly model: string | undefined }> {
  const directory = await mkdtemp(join(tmpdir(), `rolekit-${mode}-test-`))
  const capturePath = join(directory, 'capture.json')
  try {
    const options = {
      command: process.execPath,
      commandArgs: [fixturePath, mode],
      environment: { ROLEKIT_FAKE_CAPTURE: capturePath },
      timeoutMs: 10_000,
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
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.match(capture.prompt, /Final response JSON Schema/u)
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
    const { capture } = await exerciseAdapter(
      new CursorCliAdapter(),
      'cursor',
      readOnlyRole,
      readOnlyTask,
    )
    assert.ok(capture.args.includes('plan'))
    assert.ok(!capture.args.includes('--force'))
  })

  it('runs Pi in ephemeral JSON mode with tools derived from capabilities', async () => {
    const { capture, model } = await exerciseAdapter(new PiCliAdapter(), 'pi')
    assert.equal(model, 'fixture/pi-model')
    assert.ok(capture.args.includes('--no-session'))
    const toolsIndex = capture.args.indexOf('--tools')
    assert.equal(capture.args[toolsIndex + 1], 'read,grep,find,ls,edit,write,bash')
  })

  it('runs Codex exec with a temporary output schema and workspace sandbox', async () => {
    const { capture, model } = await exerciseAdapter(new CodexCliAdapter(), 'codex')
    assert.equal(model, 'codex/actual-model')
    assert.ok(capture.args.includes('exec'))
    assert.ok(capture.args.includes('--output-schema'))
    assert.ok(capture.args.includes('workspace-write'))
    assert.equal(capture.args.at(-1), '-')
  })

  it('rejects misspelled adapter options', async () => {
    await assert.rejects(
      new CursorCliAdapter().describe({ timeotMs: 100 }),
      /Unsupported adapter options/u,
    )
  })
})
