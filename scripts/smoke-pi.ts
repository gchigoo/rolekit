import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Type } from '@sinclair/typebox'

import { PiCliAdapter } from '../src/adapters/pi/index.ts'
import { PiRpcAdapter } from '../src/adapters/pi-rpc/index.ts'
import { Rolekit } from '../src/core/rolekit.ts'
import type { ExecutorAdapter, RoleSpec, TaskPacket } from '../src/core/types.ts'

const SINGLE_KEY_PI_PROVIDERS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  google: 'GEMINI_API_KEY',
} as const

const SUPPORTED_PI_PROVIDERS = [...Object.keys(SINGLE_KEY_PI_PROVIDERS), 'amazon-bedrock'] as const

export interface PiSmokeCredentialSelection {
  readonly configured: boolean
  readonly provider?: string
  readonly credentialEnvironment: Readonly<Record<string, string>>
  readonly diagnostic?: string
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = environment[key]
  return value === undefined || value.length === 0 ? undefined : value
}

export function selectPiSmokeCredentials(
  provider: string | undefined,
  model: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): PiSmokeCredentialSelection {
  if (provider === undefined || provider.length === 0) {
    return {
      configured: false,
      credentialEnvironment: {},
      diagnostic: 'Pi smoke requires an explicit ROLEKIT_PI_PROVIDER value.',
    }
  }
  if (model === undefined || model.length === 0) {
    return {
      configured: false,
      provider,
      credentialEnvironment: {},
      diagnostic: 'Pi smoke requires an explicit ROLEKIT_PI_MODEL value.',
    }
  }

  if (provider === 'amazon-bedrock') {
    const accessKey = environmentValue(environment, 'AWS_ACCESS_KEY_ID')
    const secretKey = environmentValue(environment, 'AWS_SECRET_ACCESS_KEY')
    if (accessKey === undefined || secretKey === undefined) {
      const missing = [
        ...(accessKey === undefined ? ['AWS_ACCESS_KEY_ID'] : []),
        ...(secretKey === undefined ? ['AWS_SECRET_ACCESS_KEY'] : []),
      ]
      return {
        configured: false,
        provider,
        credentialEnvironment: {},
        diagnostic: `Pi provider "amazon-bedrock" requires matching credentials: ${missing.join(', ')}.`,
      }
    }
    const sessionToken = environmentValue(environment, 'AWS_SESSION_TOKEN')
    return {
      configured: true,
      provider,
      credentialEnvironment: {
        AWS_ACCESS_KEY_ID: accessKey,
        AWS_SECRET_ACCESS_KEY: secretKey,
        ...(sessionToken === undefined ? {} : { AWS_SESSION_TOKEN: sessionToken }),
      },
    }
  }

  if (!Object.hasOwn(SINGLE_KEY_PI_PROVIDERS, provider)) {
    return {
      configured: false,
      provider,
      credentialEnvironment: {},
      diagnostic: `Pi smoke provider "${provider}" is unsupported. Supported providers: ${SUPPORTED_PI_PROVIDERS.join(', ')}.`,
    }
  }
  const key = SINGLE_KEY_PI_PROVIDERS[provider as keyof typeof SINGLE_KEY_PI_PROVIDERS]
  const credential = environmentValue(environment, key)
  if (credential === undefined) {
    return {
      configured: false,
      provider,
      credentialEnvironment: {},
      diagnostic: `Pi provider "${provider}" requires matching credential ${key}.`,
    }
  }
  return {
    configured: true,
    provider,
    credentialEnvironment: { [key]: credential },
  }
}

async function runAdapterSmoke(
  adapter: ExecutorAdapter,
  role: RoleSpec,
  task: TaskPacket,
  directory: string,
  adapterOptions: Readonly<Record<string, unknown>>,
): Promise<void> {
  const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
  const compilation = rolekit.compile(task, {
    executorId: adapter.id,
    adapterOptions,
  })
  assert.equal(compilation.publicOptions.provider, adapterOptions.provider)
  assert.equal(compilation.publicOptions.model, adapterOptions.model)

  const result = await rolekit.run(task, {
    executorId: adapter.id,
    cwd: directory,
    adapterOptions,
    runId: `${adapter.id}-scheduled-smoke`,
  })
  assert.equal(result.status, 'completed', result.error?.message)
  assert.deepEqual(result.output, { ok: true })
  assert.equal(typeof result.executor.executorVersion, 'string')
  assert.ok((result.executor.executorVersion ?? '').length > 0)
  console.log(`${adapter.id} smoke passed with ${result.executor.executorVersion}.`)
}

async function runSmoke(): Promise<void> {
  const selection = selectPiSmokeCredentials(
    process.env.ROLEKIT_PI_PROVIDER,
    process.env.ROLEKIT_PI_MODEL,
    process.env,
  )
  if (!selection.configured || selection.provider === undefined) {
    throw new Error(selection.diagnostic ?? 'Pi smoke credential selection failed.')
  }
  const provider = selection.provider
  const model = process.env.ROLEKIT_PI_MODEL as string
  const environment = selection.credentialEnvironment

  const role: RoleSpec<Readonly<Record<string, never>>, { readonly ok: boolean }> = {
    schema: 'rolekit/role-spec@1',
    id: 'pi-smoke-reader',
    description: 'Runs one bounded read-only Pi smoke task.',
    instructions: 'Return only the strict requested output with ok=true.',
    requiredCapabilities: ['repository.read'],
    inputSchema: Type.Object({}, { additionalProperties: false }),
    outputSchema: Type.Object({ ok: Type.Boolean() }, { additionalProperties: false }),
  }
  const task: TaskPacket<Readonly<Record<string, never>>> = {
    schema: 'rolekit/task-packet@1',
    taskId: 'pi-smoke-task',
    roleId: role.id,
    objective: 'Return the strict smoke output without modifying the workspace.',
    input: {},
    context: [],
    constraints: ['Read only; do not modify the workspace.'],
    acceptanceCriteria: ['The strict completed output is returned.'],
    expectedArtifacts: [],
  }
  const adapterOptions = { provider, model, tools: ['read'], environment }
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-pi-smoke-'))
  try {
    await runAdapterSmoke(new PiCliAdapter(), role, task, directory, adapterOptions)
    await runAdapterSmoke(new PiRpcAdapter(), role, task, directory, adapterOptions)
  } finally {
    await rm(directory, { recursive: true, force: true })
    await assert.rejects(access(directory))
  }
}

const entryPath = process.argv[1]
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  if (process.env.ROLEKIT_PI_SMOKE !== '1') {
    console.log('Pi smoke skipped: set ROLEKIT_PI_SMOKE=1 to opt in.')
  } else {
    await runSmoke()
  }
}
