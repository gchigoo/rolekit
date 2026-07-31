import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ExecutorReport } from '@rolekit/core'
import type { ChangeManifest } from '../../src/gate/change-manifest.ts'
import { DEFAULT_DETECT_POLICY } from '../../src/gate/detect-policy.ts'
import {
  EMPTY_API_PATHS_WARNING,
  runDetectors,
  shouldWarnEmptyApiPaths,
} from '../../src/gate/detectors.ts'

const emptyReport = (unresolved: string[] = []): ExecutorReport => ({
  schema: 'rolekit/executor-report@1',
  task_id: 'RK-1',
  status: 'completed',
  summary: 'ok',
  changed_files: [],
  decisions: [],
  assumptions: [],
  evidence: [],
  risks: [],
  unresolved,
  recommended_next_action: 'done',
})

describe('detectors', () => {
  it('hits new-dependency on package.json add', () => {
    const manifest: ChangeManifest = {
      schema: 'rolekit/change-manifest@1',
      entries: [{ status: 'M', path: 'package.json' }],
    }
    const hits = runDetectors({
      manifest,
      verification: { passed: true, results: [], scope_violations: [] },
      executorReport: emptyReport(),
      detect: DEFAULT_DETECT_POLICY,
    })
    assert.equal(
      hits.some((h) => h.trigger === 'new-dependency'),
      true,
    )
  })

  it('negative: non-dependency path does not hit new-dependency', () => {
    const manifest: ChangeManifest = {
      schema: 'rolekit/change-manifest@1',
      entries: [{ status: 'M', path: 'src/foo.ts' }],
    }
    const hits = runDetectors({
      manifest,
      verification: { passed: true, results: [], scope_violations: [] },
      executorReport: emptyReport(),
      detect: DEFAULT_DETECT_POLICY,
    })
    assert.equal(
      hits.some((h) => h.trigger === 'new-dependency'),
      false,
    )
  })

  it('hits migration and delete; R old_path counts as delete', () => {
    const manifest: ChangeManifest = {
      schema: 'rolekit/change-manifest@1',
      entries: [
        { status: 'A', path: 'db/migrations/001.sql' },
        { status: 'R', path: 'src/b.ts', old_path: 'src/a.ts' },
      ],
    }
    const hits = runDetectors({
      manifest,
      verification: { passed: true, results: [], scope_violations: [] },
      executorReport: emptyReport(),
      detect: DEFAULT_DETECT_POLICY,
    })
    assert.ok(hits.some((h) => h.trigger === 'migration'))
    const del = hits.find((h) => h.trigger === 'delete')
    assert.ok(del?.paths?.includes('src/a.ts'))
  })

  it('public-api-change disabled when api_paths empty; warns', () => {
    assert.equal(shouldWarnEmptyApiPaths(DEFAULT_DETECT_POLICY), true)
    assert.match(EMPTY_API_PATHS_WARNING, /empty_api_paths/)
    const manifest: ChangeManifest = {
      schema: 'rolekit/change-manifest@1',
      entries: [{ status: 'M', path: 'src/api/public.ts' }],
    }
    const hits = runDetectors({
      manifest,
      verification: { passed: true, results: [], scope_violations: [] },
      executorReport: emptyReport(),
      detect: { ...DEFAULT_DETECT_POLICY, api_paths: [] },
    })
    assert.equal(
      hits.some((h) => h.trigger === 'public-api-change'),
      false,
    )
  })

  it('public-api-change positive when api_paths configured', () => {
    const manifest: ChangeManifest = {
      schema: 'rolekit/change-manifest@1',
      entries: [{ status: 'M', path: 'src/api/public.ts' }],
    }
    const hits = runDetectors({
      manifest,
      verification: { passed: true, results: [], scope_violations: [] },
      executorReport: emptyReport(),
      detect: { ...DEFAULT_DETECT_POLICY, api_paths: ['src/api/**'] },
    })
    assert.ok(hits.some((h) => h.trigger === 'public-api-change'))
  })

  it('ambiguous-requirement from unresolved; escalation does not create hits', () => {
    const hits = runDetectors({
      manifest: { schema: 'rolekit/change-manifest@1', entries: [] },
      verification: { passed: true, results: [], scope_violations: [] },
      executorReport: emptyReport(['need clarification']),
      detect: DEFAULT_DETECT_POLICY,
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.trigger, 'ambiguous-requirement')
  })
})
