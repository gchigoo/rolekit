import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { describe, it } from 'node:test'
import {
  captureProcessIdentity,
  commandSha256,
  isProcessIdentityLive,
  killProcessIdentityTree,
} from '../../src/process-identity.ts'

function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('ProcessIdentity process-tree control', () => {
  it('hashes exact argv and stops the matching child tree', async () => {
    const script = [
      "const { spawn } = require('node:child_process')",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
      "process.stdout.write(String(child.pid) + '\\n')",
      'setInterval(() => {}, 1000)',
    ].join(';')
    const argv = [process.execPath, '-e', script]
    const processHandle = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    assert.ok(processHandle.pid)
    const grandchildPid = await new Promise<number>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('grandchild pid timeout')), 5_000)
      processHandle.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        const match = output.match(/^(\d+)\r?\n/)
        if (!match) return
        clearTimeout(timer)
        resolve(Number(match[1]))
      })
      processHandle.once('error', reject)
    })

    try {
      const identity = await captureProcessIdentity(processHandle.pid, argv)
      assert.equal(identity.command_sha256, commandSha256(argv))
      assert.equal(await isProcessIdentityLive(identity), true)
      assert.equal(await killProcessIdentityTree(identity), true)
      assert.equal(await isProcessIdentityLive(identity), false)
      assert.equal(processIsLive(grandchildPid), false)
    } finally {
      if (processHandle.pid && processIsLive(processHandle.pid)) processHandle.kill('SIGKILL')
      if (processIsLive(grandchildPid)) {
        try {
          process.kill(grandchildPid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
    }
  })
})
