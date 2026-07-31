import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Type } from '@sinclair/typebox'

import { Rolekit, RolekitError } from '../../src/core/index.ts'
import type {
  ExecutorDescriptor,
  ExecutorResponse,
  RoleSpec,
  TaskPacket,
} from '../../src/core/types.ts'
import { FakeExecutorAdapter } from '../../src/testing/index.ts'

interface ExampleInput {
  readonly source: string
}

interface ExampleOutput {
  readonly message: string
}

const role: RoleSpec<ExampleInput, ExampleOutput> = {
  schema: 'rolekit/role-spec@1',
  id: 'implementer',
  description: 'Implements one bounded change.',
  requiredCapabilities: ['repository.read', 'repository.write'],
  inputSchema: Type.Object(
    { source: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  outputSchema: Type.Object(
    { message: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
}

const task: TaskPacket<ExampleInput> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'task-1',
  roleId: role.id,
  objective: 'Create the requested report.',
  input: { source: 'README.md' },
  context: [],
  constraints: ['Keep the change bounded.'],
  acceptanceCriteria: ['The report is returned.'],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

const descriptor: ExecutorDescriptor = {
  id: 'fake',
  displayName: 'Fake executor',
  transport: 'in-process',
  capabilities: ['repository.read', 'repository.write', 'shell'],
  available: true,
  model: 'configured-model',
  version: '1.0.0',
}

const completedResponse: ExecutorResponse<ExampleOutput> = {
  status: 'completed',
  summary: 'Report created.',
  output: { message: 'done' },
  artifacts: [{ name: 'report', kind: 'text', content: 'done' }],
  evidence: [{ kind: 'note', value: 'fake execution' }],
  model: 'actual-model',
}

describe('Rolekit', () => {
  it('normalizes a successful execution with actual executor identity and provenance', async () => {
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const rolekit = new Rolekit({
      roles: [role],
      adapters: [adapter],
      createRunId: () => 'run-1',
      now: () => new Date('2026-07-31T00:00:00.000Z'),
    })

    const result = await rolekit.run<ExampleInput, ExampleOutput>(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, { message: 'done' })
    assert.equal(result.executor.id, 'fake')
    assert.equal(result.executor.model, 'actual-model')
    assert.deepEqual(result.artifacts[0]?.provenance, {
      runId: 'run-1',
      executorId: 'fake',
    })
    assert.equal(adapter.invocations.length, 1)
  })

  it('rejects task input before invoking an adapter', async () => {
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
    const invalidTask = { ...task, input: { source: '' } }

    await assert.rejects(
      rolekit.run(invalidTask, {
        executorId: 'fake',
        cwd: 'D:/project',
        adapterOptions: {},
      }),
      (error: unknown) =>
        error instanceof RolekitError &&
        error.code === 'invalid_contract' &&
        error.message.includes('input'),
    )
    assert.equal(adapter.invocations.length, 0)
  })

  it('blocks a capability mismatch without executing the adapter', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor: {
        ...descriptor,
        capabilities: ['repository.read'],
      },
      response: completedResponse,
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
      runId: 'capability-run',
    })

    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'capability_mismatch')
    assert.equal(adapter.invocations.length, 0)
  })

  it('fails output that does not match the role schema', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: {
        ...completedResponse,
        output: { unexpected: true },
      },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'output_validation_failed')
  })

  it('fails when an expected artifact is absent', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: { ...completedResponse, artifacts: [] },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'missing_artifact')
  })

  it('accepts a fourth adapter through the public registry without a core change', async () => {
    const adapters = ['pi', 'cursor', 'codex', 'custom'].map(
      (id) =>
        new FakeExecutorAdapter({
          descriptor: { ...descriptor, id },
          response: completedResponse,
        }),
    )
    const rolekit = new Rolekit({ roles: [role], adapters })

    const result = await rolekit.run(task, {
      executorId: 'custom',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'completed')
    assert.deepEqual(rolekit.listAdapterIds(), ['codex', 'cursor', 'custom', 'pi'])
    assert.equal(adapters[3]?.invocations.length, 1)
  })
})
