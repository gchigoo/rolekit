import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

import {
  CliOutputLimitError,
  CliProtocolError,
  CliTimeoutError,
} from '../../src/adapters/cli/errors.ts'
import { PiRpcClient } from '../../src/adapters/pi-rpc/index.ts'

const fixturePath = resolve('test', 'fixtures', 'fake-pi-rpc.mjs')

function within<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolvePromise, rejectPromise) => {
      const timeout = setTimeout(
        () => rejectPromise(new Error(`Promise did not settle within ${timeoutMs} ms.`)),
        timeoutMs,
      )
      timeout.unref()
    }),
  ])
}

async function withClient<T>(
  mode: string,
  run: (client: PiRpcClient) => Promise<T>,
  options: { readonly maxOutputBytes?: number; readonly timeoutMs?: number } = {},
): Promise<T> {
  await chmod(fixturePath, 0o755)
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-pi-rpc-client-'))
  const client = await PiRpcClient.start({
    command: fixturePath,
    args: ['--mode', 'rpc', '--no-session'],
    cwd: directory,
    environment: {
      PATH: process.env.PATH ?? '',
      ROLEKIT_FAKE_RPC_MODE: mode,
    },
    timeoutMs: options.timeoutMs ?? 500,
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    redaction: { sensitiveFlags: [], sensitiveValues: [] },
    onEvent: () => {},
  })
  void client.completion.catch(() => undefined)
  try {
    return await run(client)
  } finally {
    await client.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Pi RPC client', () => {
  it('correlates out-of-order responses to their original requests', async () => {
    await withClient('client-out-of-order', async (client) => {
      const first = client.request({ type: 'first' })
      const second = client.request({ type: 'second' })

      const [firstResponse, secondResponse] = await Promise.all([first, second])
      assert.equal(firstResponse.command, 'first')
      assert.deepEqual(firstResponse.data, { order: 1 })
      assert.equal(secondResponse.command, 'second')
      assert.deepEqual(secondResponse.data, { order: 2 })
    })
  })

  it('rejects an unknown response id as a protocol failure', async () => {
    await withClient('client-unknown-id', async (client) => {
      await assert.rejects(
        client.request({ type: 'unknown-id' }),
        (error: unknown) =>
          error instanceof CliProtocolError && /was not pending/u.test(error.message),
      )
      await assert.rejects(within(client.completion), CliProtocolError)
    })
  })

  it('rejects a duplicate response id after the correlated response resolves', async () => {
    await withClient('client-duplicate-id', async (client) => {
      const response = await client.request({ type: 'duplicate-id' })
      assert.equal(response.command, 'duplicate-id')
      await assert.rejects(
        within(client.completion),
        (error: unknown) =>
          error instanceof CliProtocolError && /was not pending/u.test(error.message),
      )
    })
  })

  it('makes a response command mismatch terminal for the client', async () => {
    await withClient('client-command-mismatch', async (client) => {
      await assert.rejects(
        client.request({ type: 'mismatch' }),
        (error: unknown) =>
          error instanceof CliProtocolError && /did not match/u.test(error.message),
      )
      await assert.rejects(client.request({ type: 'get_state' }), CliProtocolError)
      await assert.rejects(within(client.completion), CliProtocolError)
    })
  })

  it('makes a per-request timeout terminal and rejects later requests', async () => {
    await withClient(
      'client-timeout',
      async (client) => {
        await assert.rejects(client.request({ type: 'slow' }, 50), CliTimeoutError)
        await assert.rejects(client.request({ type: 'get_state' }), CliTimeoutError)
        await assert.rejects(within(client.completion), CliTimeoutError)
      },
      { timeoutMs: 500 },
    )
  })

  it('rejects every pending request when the process exits', async () => {
    await withClient('client-exit-pending', async (client) => {
      const first = client.request({ type: 'pending-one' })
      const second = client.request({ type: 'pending-two' })
      const settled = await Promise.allSettled([first, second])

      assert.deepEqual(
        settled.map((result) => result.status),
        ['rejected', 'rejected'],
      )
      for (const result of settled) {
        assert.ok(result.status === 'rejected' && result.reason instanceof CliProtocolError)
      }
      await assert.rejects(within(client.completion), CliProtocolError)
    })
  })

  it('enforces one aggregate stdout and stderr output bound', async () => {
    await withClient(
      'client-output-overflow',
      async (client) => {
        await assert.rejects(client.request({ type: 'overflow' }), CliOutputLimitError)
        await assert.rejects(within(client.completion), CliOutputLimitError)
      },
      { maxOutputBytes: 128 },
    )
  })
})
