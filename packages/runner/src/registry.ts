import type { ExecutorAdapter, ExecutorAdapterFactory } from './adapter.ts'
import { UnknownAdapterError } from './errors.ts'
import { createChatgptCodexExecutor } from './executors/chatgpt-codex.ts'
import { createMockExecutor } from './executors/mock.ts'
import { createOpenAiResponsesExecutor } from './executors/openai-responses.ts'
import { createPiRpcExecutor } from './executors/pi-rpc.ts'
import type { AdapterCreateOptions } from './types.ts'

const factories = new Map<string, ExecutorAdapterFactory>([
  ['chatgpt-codex', createChatgptCodexExecutor],
  ['mock', createMockExecutor],
  ['openai-responses', createOpenAiResponsesExecutor],
  ['pi-rpc', createPiRpcExecutor],
])

/**
 * Returns whether an adapter name is registered.
 */
export function isRegisteredAdapter(name: string): boolean {
  return factories.has(name)
}

/**
 * Lists built-in adapter names.
 */
export function listAdapters(): string[] {
  return [...factories.keys()].sort()
}

/**
 * Creates an adapter instance from the registry.
 */
export function createAdapter(name: string, options: AdapterCreateOptions): ExecutorAdapter {
  const factory = factories.get(name)
  if (!factory) {
    throw new UnknownAdapterError(name)
  }
  return factory(options)
}

/**
 * Test-only registration hook for ephemeral adapters.
 */
export function registerAdapterForTests(name: string, factory: ExecutorAdapterFactory): void {
  factories.set(name, factory)
}
