import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const targets = [
  'evidence/verifier-gate-engine/observe/task.json',
  'evidence/verifier-gate-engine/observe/result.json',
  'evidence/verifier-gate-engine/observe/gates.json',
  'evidence/verifier-gate-engine/observe/policy-snapshot.json',
  'evidence/verifier-gate-engine/scope-block/task.json',
  'evidence/verifier-gate-engine/scope-block/result.json',
  'evidence/verifier-gate-engine/scope-block/gates.json',
  'fixtures/gate-record/valid-observe.json',
]
const cli = join('packages/cli/bin/rolekit.js')
let failed = false
for (const file of targets) {
  if (!existsSync(file)) {
    console.error('missing', file)
    failed = true
    continue
  }
  const r = spawnSync(process.execPath, [cli, 'validate', file, '--json'], { encoding: 'utf8' })
  const ok = r.status === 0
  console.log(file, ok ? 'ok' : 'FAIL', (r.stdout || '').trim().slice(0, 100))
  if (!ok) failed = true
}
// invalid fixtures must fail validation
for (const file of [
  'fixtures/gate-record/invalid-bad-decision.json',
  'fixtures/gate-record/invalid-observe-with-resolution.json',
]) {
  if (!existsSync(file)) continue
  const r = spawnSync(process.execPath, [cli, 'validate', file, '--json'], { encoding: 'utf8' })
  const ok = r.status !== 0
  console.log(file, ok ? 'invalid-as-expected' : 'UNEXPECTED-PASS')
  if (!ok) failed = true
}
process.exit(failed ? 1 : 0)
