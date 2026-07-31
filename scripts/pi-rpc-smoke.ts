/**
 * Windows Pi RPC smoke: probe + minimal prompt round-trip + cancel terminate.
 * Evidence written under evidence/pi-rpc-vertical-slice/smoke/.
 */
import { mkdirSync, writeFileSync as write, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRunInput } from '../packages/runner/src/loaders.ts'
import { createAdapter } from '../packages/runner/src/registry.ts'
import { RunManager } from '../packages/runner/src/run-manager.ts'
import type { ProbeResult } from '../packages/runner/src/types.ts'
import { createTempProject } from '../packages/runner/test/helpers/temp-project.ts'

const evidenceDir = join(process.cwd(), 'evidence', 'pi-rpc-vertical-slice', 'smoke')
mkdirSync(evidenceDir, { recursive: true })

const { root } = createTempProject()
// switch default mock task project to use pi executor for a tiny prompt task
write(
  join(root, 'tasks', 'pi-smoke.yaml'),
  `schema: rolekit/task-contract@1
id: RK-20260728-PI1
kind: implementation
role: minimal-implementer
executor: pi
objective: Reply with the single word pong and do not edit files
context:
  required_files:
    - src/seed.txt
  docs: []
scope:
  writable:
    - src/**
  forbidden:
    - "**/.env*"
constraints:
  - Do not modify any files
deliverables:
  - a short reply
acceptance:
  commands:
    - run: node -e "process.exit(0)"
      expect_exit: 0
  assertions:
    - no file changes required
execution:
  worktree: isolated
  max_tool_calls: 5
  network: allow
  timeout_minutes: 3
escalation:
  on_scope_change: return_blocked
  on_new_dependency: require_approval
  on_ambiguous_requirement: return_question
`,
)

const adapter = createAdapter('pi-rpc', {
  projectRoot: root,
  compatRange: '>=0.80 <0.90',
})

const failures: string[] = []
let probeOut: ProbeResult | undefined
try {
  probeOut = await adapter.probe()
  writeFileSync(join(evidenceDir, 'probe.json'), `${JSON.stringify(probeOut, null, 2)}\n`)
  if (probeOut.capabilities.includes('steer')) {
    failures.push('probe unexpectedly declared steer')
  }
} catch (error) {
  failures.push(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
  writeFileSync(join(evidenceDir, 'probe-error.txt'), String(error))
  writeFileSync(
    join(evidenceDir, 'RESULT.md'),
    `# Pi RPC smoke\n\nstatus: failed\n\nprobe error — see probe-error.txt\n`,
  )
  process.exit(1)
}
if (!probeOut) {
  process.exit(1)
}

// minimal RPC round-trip via RunManager (requires network/model)
const input = await loadRunInput(join(root, 'tasks', 'pi-smoke.yaml'), { projectRoot: root })
const rm = new RunManager(root)
const handle = await rm.prepare({ ...input, retry: false })
await rm.startPrepared(handle.run_id)

// cancel quickly to validate terminate path (also covers abort of in-flight prompt)
await new Promise((r) => setTimeout(r, 1500))
await rm.cancel(handle.run_id)
const settled = await rm.waitUntilSettled(handle.run_id)
const result = await rm.collect(handle.run_id)
writeFileSync(join(evidenceDir, 'cancel-result.json'), `${JSON.stringify(result, null, 2)}\n`)
writeFileSync(join(evidenceDir, 'settled.json'), `${JSON.stringify(settled, null, 2)}\n`)

const events = await import('node:fs').then((fs) =>
  fs.readFileSync(join(root, '.rolekit', 'runs', handle.run_id, 'events.jsonl'), 'utf8'),
)
writeFileSync(join(evidenceDir, 'events.jsonl'), events)

const hasMessage = events.includes('"type":"message"') || events.includes('"type": "message"')
const cancelledOk = result.status === 'cancelled' || result.status === 'failed'

writeFileSync(
  join(evidenceDir, 'RESULT.md'),
  `# Pi RPC smoke\n\n` +
    `status: ${failures.length === 0 && cancelledOk ? 'passed-partial' : 'needs-review'}\n\n` +
    `- probe adapter=${probeOut.adapter} version_protocol=${probeOut.protocol_version}\n` +
    `- capabilities=${probeOut.capabilities.join(',')}\n` +
    `- has_message_event=${hasMessage}\n` +
    `- cancel/collect status=${result.status}\n` +
    `- run_id=${handle.run_id}\n` +
    `- project=${root}\n`,
)

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`smoke evidence: ${evidenceDir}\n`)
