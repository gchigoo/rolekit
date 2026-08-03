import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Type } from '@sinclair/typebox'

import { CodexCliAdapter } from '../src/adapters/codex/index.ts'
import { Rolekit } from '../src/core/rolekit.ts'
import type { RoleSpec, TaskPacket } from '../src/core/types.ts'

const execFileAsync = promisify(execFile)
const CODEX_CREDENTIAL_KEYS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'AZURE_OPENAI_API_KEY'] as const

async function runSmoke(): Promise<void> {
  const credentialKey = CODEX_CREDENTIAL_KEYS.find((key) => {
    const value = process.env[key]
    return value !== undefined && value.length > 0
  })
  if (credentialKey === undefined) {
    throw new Error(
      `Codex smoke requires one explicit credential: ${CODEX_CREDENTIAL_KEYS.join(', ')}.`,
    )
  }

  const requestedModel = process.env.ROLEKIT_CODEX_MODEL
  if (requestedModel === undefined || requestedModel.length === 0) {
    throw new Error('Codex smoke requires an explicit ROLEKIT_CODEX_MODEL value.')
  }
  const requestedProfile = process.env.ROLEKIT_CODEX_PROFILE
  const credential = process.env[credentialKey]
  if (credential === undefined || credential.length === 0) {
    throw new Error('Codex smoke credential selection failed.')
  }

  const directory = await mkdtemp(join(tmpdir(), 'rolekit-codex-smoke-'))
  try {
    await execFileAsync('git', ['init', '--quiet'], { cwd: directory })

    const role: RoleSpec<
      Readonly<Record<string, never>>,
      { readonly repository: string; readonly clean: boolean }
    > = {
      schema: 'rolekit/role-spec@1',
      id: 'codex-smoke-reader',
      description: 'Reads a temporary repository without modifying it.',
      instructions:
        'Inspect the repository read-only. Return repository="temporary" and clean=true. Do not create or modify files.',
      requiredCapabilities: ['repository.read'],
      inputSchema: Type.Object({}, { additionalProperties: false }),
      outputSchema: Type.Object(
        {
          repository: Type.String(),
          clean: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    }
    const task: TaskPacket<Readonly<Record<string, never>>> = {
      schema: 'rolekit/task-packet@1',
      taskId: 'codex-smoke-task',
      roleId: role.id,
      objective:
        'Verify this is a temporary git repository and return the requested strict output.',
      input: {},
      context: [],
      constraints: ['Read only; do not modify the repository.'],
      acceptanceCriteria: ['The strict completed output is returned.'],
      expectedArtifacts: [],
    }

    const adapter = new CodexCliAdapter()
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
    const adapterOptions = {
      model: requestedModel,
      ...(requestedProfile === undefined || requestedProfile.length === 0
        ? {}
        : { profile: requestedProfile, inheritUserConfig: true }),
      environment: { [credentialKey]: credential },
    }
    const compilation = rolekit.compile(task, {
      executorId: adapter.id,
      adapterOptions,
    })
    assert.equal(compilation.publicOptions.model, requestedModel)
    assert.equal(
      compilation.publicOptions.profile,
      requestedProfile === undefined || requestedProfile.length === 0
        ? undefined
        : requestedProfile,
    )
    assert.equal(compilation.publicOptions.sandbox, 'read-only')

    const result = await rolekit.run(task, {
      executorId: adapter.id,
      cwd: directory,
      adapterOptions,
    })
    assert.equal(result.status, 'completed', result.error?.message)
    assert.deepEqual(result.output, { repository: 'temporary', clean: true })
    assert.equal(typeof result.executor.executorVersion, 'string')
    assert.ok((result.executor.executorVersion ?? '').length > 0)
    assert.equal(result.executor.actualModel, undefined)
    console.log(`Codex smoke passed with ${result.executor.executorVersion}.`)
  } finally {
    await rm(directory, { recursive: true, force: true })
    await assert.rejects(access(directory))
  }
}

if (process.env.ROLEKIT_CODEX_SMOKE !== '1') {
  console.log('Codex smoke skipped: set ROLEKIT_CODEX_SMOKE=1 to opt in.')
} else {
  await runSmoke()
}
