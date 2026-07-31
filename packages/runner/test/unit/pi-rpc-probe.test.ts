import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { createStrictJsonlReader } from '../../src/jsonl-framing.ts'
import { createAdapter } from '../../src/registry.ts'
import { createTempProject } from '../helpers/temp-project.ts'

describe('PiRpcExecutor probe + framing', () => {
  it('probe declares steer when pi is available', async () => {
    const probe = spawnSync('pi', ['--version'], { encoding: 'utf8', windowsHide: true })
    if (probe.status !== 0) {
      // NeedsHuman path — code still unit-tested via framing below
      return
    }
    const { root } = createTempProject()
    const adapter = createAdapter('pi-rpc', { projectRoot: root, compatRange: '>=0.80 <0.90' })
    const result = await adapter.probe()
    assert.equal(result.adapter, 'pi-rpc')
    assert.ok(result.capabilities.includes('start'))
    assert.ok(result.capabilities.includes('cancel'))
    assert.ok(result.capabilities.includes('collect'))
    assert.equal(result.capabilities.includes('steer'), true)
  })

  it('strict reader keeps U+2028 inside one record', async () => {
    const payload = JSON.stringify({ type: 'message_update', text: `x\u2028y` })
    const stream = Readable.from([`${payload}\n`])
    const lines: string[] = []
    await new Promise<void>((resolve) => {
      createStrictJsonlReader(stream, (l) => lines.push(l))
      stream.on('end', () => resolve())
    })
    assert.equal(lines.length, 1)
    assert.equal(JSON.parse(lines[0]!).text, 'x\u2028y')
  })
})
