/**
 * Builds minimal valid run artifact trees for evals unit tests.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import type { SeedExpectation } from '../../src/types.ts'

/** Minimal valid TaskContract JSON. */
export function sampleTask(id = 'RK-EVAL-1'): Record<string, unknown> {
  return {
    schema: 'rolekit/task-contract@1',
    id,
    kind: 'implementation',
    role: 'implementer',
    executor: 'mock',
    objective: 'Write a file for evals fixture',
    context: { required_files: [], docs: [] },
    scope: { writable: ['src/**'], forbidden: ['secrets/**'] },
    constraints: [],
    deliverables: ['src/out.txt'],
    acceptance: {
      commands: [{ run: 'node -e "process.exit(0)"', expect_exit: 0 }],
      assertions: [],
    },
    execution: {
      worktree: 'isolated',
      max_tool_calls: 10,
      network: 'deny',
      timeout_minutes: 5,
    },
    escalation: {
      on_scope_change: 'return_blocked',
      on_new_dependency: 'require_approval',
      on_ambiguous_requirement: 'return_question',
    },
  }
}

/** Minimal ResultEnvelope JSON. */
export function sampleEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'rolekit/result-envelope@1',
    task_id: 'RK-EVAL-1',
    status: 'completed',
    summary: 'ok',
    changed_files: ['src/out.txt'],
    verification: [{ command: 'node -e "process.exit(0)"', exit_code: 0 }],
    scope_violations: [],
    decisions: [],
    assumptions: [],
    evidence: ['events.jsonl', 'verification.json', 'result.json'],
    risks: [],
    unresolved: [],
    recommended_next_action: 'done',
    ...overrides,
  }
}

/** Minimal verification.json. */
export function sampleVerification(scope_violations: string[] = []): Record<string, unknown> {
  return {
    passed: scope_violations.length === 0,
    results: [{ command: 'node -e "process.exit(0)"', exit_code: 0 }],
    scope_violations,
  }
}

export type WriteSeedOpts = {
  dir: string
  name: string
  expectation: SeedExpectation
  source?: string
  task?: Record<string, unknown>
  result?: Record<string, unknown>
  verification?: Record<string, unknown>
  prompt?: string
  events?: string
  writeMeta?: boolean
}

/**
 * Writes a complete seed directory (five artifacts + optional seed.yaml).
 */
export function writeSeed(opts: WriteSeedOpts): void {
  mkdirSync(opts.dir, { recursive: true })
  writeFileSync(
    join(opts.dir, 'task.json'),
    `${JSON.stringify(opts.task ?? sampleTask(), null, 2)}\n`,
  )
  writeFileSync(join(opts.dir, 'prompt.md'), opts.prompt ?? '# prompt\n')
  writeFileSync(
    join(opts.dir, 'events.jsonl'),
    opts.events ??
      `${JSON.stringify({
        schema: 'rolekit/run-event@1',
        ts: '2026-07-28T00:00:00.000Z',
        run_id: 'run-mock',
        type: 'started',
        payload: { task_id: 'RK-EVAL-1', adapter: 'mock', worktree: 'worktrees/run-mock' },
      })}\n`,
  )
  writeFileSync(
    join(opts.dir, 'result.json'),
    `${JSON.stringify(opts.result ?? sampleEnvelope(), null, 2)}\n`,
  )
  writeFileSync(
    join(opts.dir, 'verification.json'),
    `${JSON.stringify(opts.verification ?? sampleVerification(), null, 2)}\n`,
  )
  if (opts.writeMeta !== false) {
    writeFileSync(
      join(opts.dir, 'seed.yaml'),
      stringifyYaml({
        name: opts.name,
        source: opts.source ?? 'mock',
        expectation: opts.expectation,
        captured: '2026-07-28',
      }),
    )
  }
}
