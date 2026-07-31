---
doc_type: feature-evidence-pack
feature: 2026-07-24-host-adapter-skills
status: generated
---

# 2026-07-24-host-adapter-skills evidence pack

## 1. Scope

- Design: `D:\Personal\rolekit\.codestable\features\2026-07-24-host-adapter-skills\host-adapter-skills-design.md`
- Checklist: `D:\Personal\rolekit\.codestable\features\2026-07-24-host-adapter-skills\host-adapter-skills-checklist.yaml`

## 2. DoD Results

```json
{
  "gate_id": "dod-runner",
  "stage": "implementation.before_review",
  "status": "passed",
  "blocking": [],
  "warnings": [],
  "evidence": [
    {
      "command": "npm run lint:adapters",
      "exit_code": 0,
      "stdout": "\n> rolekit@0.0.0 lint:adapters\n> node scripts/lint-adapters.mjs\n\nlint:adapters ok\n",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx biome check .",
      "exit_code": 0,
      "stdout": "The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.\nDiagnostics not shown: 6.\nChecked 89 files in 54ms. No fixes applied.\nFound 26 warnings.\n",
      "stderr": "               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    106 │       if (\n    107 │         state.phase === 'terminal' ||\n  \n\npackages\\runner\\src\\run-supervisor.ts:124:17 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    122 │           termination_intent: { status: 'failed', reason: 'timeout' },\n    123 │         }))\n  > 124 │         state = (await readRunState(projectRoot, runId))!\n        │                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    125 │       }\n    126 │ \n  \n\npackages\\runner\\src\\semver-range.ts:49:9 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │         ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:49:19 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │                   ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:50:14 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │              ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\semver-range.ts:50:22 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │                      ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\worktree.ts:171:18 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    169 │   const out: Array<{ code: string; path: string }> = []\n    170 │   for (let i = 0; i < parts.length; i += 1) {\n  > 171 │     const part = parts[i]!\n        │                  ^^^^^^^^^\n    172 │     if (part.length < 3) {\n    173 │       continue\n  \n\npackages\\runner\\test\\unit\\jsonl-framing.test.ts:16:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    14 │     })\n    15 │     assert.equal(lines.length, 1)\n  > 16 │     assert.equal(JSON.parse(lines[0]!).text, 'a\\u2028b\\u2029c')\n       │                             ^^^^^^^^^\n    17 │   })\n    18 │ })\n  \n\npackages\\runner\\test\\unit\\pi-rpc-probe.test.ts:35:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    33 │     })\n    34 │     assert.equal(lines.length, 1)\n  > 35 │     assert.equal(JSON.parse(lines[0]!).text, 'x\\u2028y')\n       │                             ^^^^^^^^^\n    36 │   })\n    37 │ })\n  \n\nscripts\\extract-pi-session.mjs:108:13 lint/complexity/useOptionalChain  FIXABLE  ━━━━━━━━━━━━━━━━━━━\n\n  ! Change to an optional chain.\n  \n    106 │     if (role === 'assistant' && Array.isArray(msg.content)) {\n    107 │       for (const part of msg.content) {\n  > 108 │         if (!part || part.type !== 'toolCall') continue\n        │             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    109 │         const name = part.name || part.toolName\n    110 │         const args = part.arguments || {}\n  \n  i Unsafe fix: Change to an optional chain.\n  \n    106 106 │       if (role === 'assistant' && Array.isArray(msg.content)) {\n    107 107 │         for (const part of msg.content) {\n    108     │ - ········if·(!part·||·part.type·!==·'toolCall')·continue\n        108 │ + ········if·(part?.type·!==·'toolCall')·continue\n    109 109 │           const name = part.name || part.toolName\n    110 110 │           const args = part.arguments || {}\n  \n\n",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "node scripts/validate-adapter-artifact.ts",
      "exit_code": 0,
      "stdout": "validate-adapter-artifact host=pi runDir=D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\pi\\run-dir\n  rolekit validate task.json ok=true\n  presence-check prompt.md ok=true (markdown; no registered schema)\n  rolekit validate events.jsonl lines=3 ok=true\n  rolekit validate result.json ok=true\n  shape-check verification.json ok=true (no schema field in runner artifact)\nvalidate-adapter-artifact host=cursor runDir=D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\cursor\\run-dir\n  rolekit validate task.json ok=true\n  presence-check prompt.md ok=true (markdown; no registered schema)\n  rolekit validate events.jsonl lines=3 ok=true\n  rolekit validate result.json ok=true\n  shape-check verification.json ok=true (no schema field in runner artifact)\n",
      "stderr": "",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "node scripts/check-delegation-live.ts",
      "exit_code": 0,
      "stdout": "extract-pi-session wrote D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\pi\\session.extracted.md skill=true commands=5\ncheck-delegation-live host=pi\n  authentic=D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\pi\\session.jsonl\n  runDir=D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\pi\\run-dir\ncheck:delegation pass skill=rolekit-adapter-pi commands=5 source=pi-jsonl→extract-pi-session\n  extracted-check: D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\pi\\session.extracted.md\ncheck:delegation pass skill=rolekit-adapter-pi commands=5 source=text\nextract-cursor-session wrote D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\cursor\\session.export.md skill=rolekit-adapter-cursor commands=5\ncheck-delegation-live host=cursor\n  authentic=D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\cursor\\session.raw.json\n  runDir=D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\cursor\\run-dir\ncheck:delegation pass skill=rolekit-adapter-cursor commands=5 source=cursor-raw-json\n  extracted-check: D:\\Personal\\rolekit\\evidence\\host-adapter-skills\\cursor\\session.export.md\ncheck:delegation pass skill=rolekit-adapter-cursor commands=5 source=text\n",
      "stderr": "",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block"
    }
  ],
  "providers": {},
  "feature": "2026-07-24-host-adapter-skills",
  "inputs": {
    "checklist": ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-checklist.yaml"
  },
  "input_digests": {
    "checklist": "ec8a763d1d6c56a0c0c766e727a885085f69619bae33ac9f016c134501e58a0e"
  },
  "kind": "executable"
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 10756
Checklist bytes: 3318

## 5. Residual Risks

- none

## 6. Provider Signals

```json
{
  "archguard": {
    "status": "unavailable",
    "reason": "archguard binary not found on PATH",
    "warnings": []
  },
  "meta_cc": {
    "status": "unavailable",
    "reason": "meta-cc summary not found; realtime session collection is out of scope",
    "warnings": []
  }
}
```

## 7. Gate Results

```json
{
  "gate_id": "scope-gate",
  "stage": "implementation.before_review",
  "status": "passed",
  "blocking": [],
  "warnings": [],
  "evidence": [
    {
      "changed_files": [
        ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-checklist.yaml",
        ".codestable/roadmap/rolekit-v2/goal-state.yaml",
        ".github/workflows/ci.yml",
        ".gitignore",
        "biome.json",
        "package.json",
        "scripts/run-tests.ts",
        ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-dod-contract-results.json",
        ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-evidence-pack.md",
        ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-review.md",
        "adapters/build.mjs",
        "adapters/codex/README.md",
        "adapters/codex/SKILL.md",
        "adapters/cursor/README.md",
        "adapters/cursor/SKILL.md",
        "adapters/pi/README.md",
        "adapters/pi/SKILL.md",
        "adapters/shared/command-map.md",
        "adapters/shared/command-map.mjs",
        "evidence/host-adapter-skills/ARCHIVE.md",
        "evidence/host-adapter-skills/WRITEBACK-NOTES.md",
        "evidence/host-adapter-skills/check-delegation-live.txt",
        "evidence/host-adapter-skills/cursor/POINTER.md",
        "evidence/host-adapter-skills/cursor/check-delegation.txt",
        "evidence/host-adapter-skills/cursor/project-meta.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/candidate.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/executor-control.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/executor-report.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/integration-plan.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/integration-result.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/integration.patch",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/mock-report.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/reverify-2026-07-28T09-49-41-381Z.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/reverify-2026-07-28T10-02-46-738Z.json",
        "evidence/host-adapter-skills/cursor/run-dir/artifacts/supervisor.json",
        "evidence/host-adapter-skills/cursor/run-dir/baseline.json",
        "evidence/host-adapter-skills/cursor/run-dir/events.jsonl",
        "evidence/host-adapter-skills/cursor/run-dir/executor-profile-snapshot.json",
        "evidence/host-adapter-skills/cursor/run-dir/policy-snapshot.json",
        "evidence/host-adapter-skills/cursor/run-dir/profile-snapshot.json",
        "evidence/host-adapter-skills/cursor/run-dir/prompt.md",
        "evidence/host-adapter-skills/cursor/run-dir/result.json",
        "evidence/host-adapter-skills/cursor/run-dir/run-state.json",
        "evidence/host-adapter-skills/cursor/run-dir/task.json",
        "evidence/host-adapter-skills/cursor/run-dir/verification.json",
        "evidence/host-adapter-skills/cursor/session.export.md",
        "evidence/host-adapter-skills/cursor/session.md",
        "evidence/host-adapter-skills/cursor/session.raw.json",
        "evidence/host-adapter-skills/cursor/skill-version.json",
        "evidence/host-adapter-skills/pi/POINTER.md",
        "evidence/host-adapter-skills/pi/check-delegation.txt",
        "evidence/host-adapter-skills/pi/project-meta.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/candidate.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/executor-control.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/executor-report.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/integration-plan.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/integration-result.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/integration.patch",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/mock-report.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/reverify-2026-07-28T09-52-09-971Z.json",
        "evidence/host-adapter-skills/pi/run-dir/artifacts/supervisor.json",
        "evidence/host-adapter-skills/pi/run-dir/baseline.json",
        "evidence/host-adapter-skills/pi/run-dir/events.jsonl",
        "evidence/host-adapter-skills/pi/run-dir/executor-profile-snapshot.json",
        "evidence/host-adapter-skills/pi/run-dir/policy-snapshot.json",
        "evidence/host-adapter-skills/pi/run-dir/profile-snapshot.json",
        "evidence/host-adapter-skills/pi/run-dir/prompt.md",
        "evidence/host-adapter-skills/pi/run-dir/result.json",
        "evidence/host-adapter-skills/pi/run-dir/run-state.json",
        "evidence/host-adapter-skills/pi/run-dir/task.json",
        "evidence/host-adapter-skills/pi/run-dir/verification.json",
        "evidence/host-adapter-skills/pi/session.extracted.md",
        "evidence/host-adapter-skills/pi/session.jsonl",
        "evidence/host-adapter-skills/pi/session.md",
        "evidence/host-adapter-skills/pi/skill-version.json",
        "evidence/host-adapter-skills/validate-artifacts.txt",
        "scripts/check-delegated-run.mjs",
        "scripts/check-delegation-live.ts",
        "scripts/extract-cursor-session.mjs",
        "scripts/extract-pi-session.mjs",
        "scripts/host-adapter-evidence.mjs",
        "scripts/install-skill.mjs",
        "scripts/lint-adapters.mjs",
        "scripts/validate-adapter-artifact.ts",
        "test/adapters/check-delegated-run.test.ts",
        "test/adapters/fixtures/run-dir/events.jsonl",
        "test/adapters/fixtures/run-dir/prompt.md",
        "test/adapters/fixtures/run-dir/result.json",
        "test/adapters/fixtures/run-dir/task.json",
        "test/adapters/fixtures/run-dir/verification.json",
        "test/adapters/fixtures/sessions/negative-noskill.md",
        "test/adapters/fixtures/sessions/negative-oos.md",
        "test/adapters/fixtures/sessions/pi-positive.jsonl",
        "test/adapters/fixtures/sessions/positive.md"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-dod-results.json",
        ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-evidence-pack-results.json",
        ".codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-gate-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-24-host-adapter-skills",
        "adapters/",
        "scripts/",
        "evidence/",
        "packages/",
        ".codestable/",
        "test/",
        "package.json",
        "package-lock.json",
        ".github/",
        ".gitignore",
        "biome.json"
      ]
    }
  ],
  "providers": {},
  "feature": "2026-07-24-host-adapter-skills",
  "inputs": {
    "feature_dir": ".codestable/features/2026-07-24-host-adapter-skills"
  },
  "input_digests": {},
  "kind": "executable"
}
```
