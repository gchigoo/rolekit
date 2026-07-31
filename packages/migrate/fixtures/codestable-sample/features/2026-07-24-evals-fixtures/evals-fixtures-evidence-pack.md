---
doc_type: feature-evidence-pack
feature: 2026-07-24-evals-fixtures
status: generated
---

# 2026-07-24-evals-fixtures evidence pack

## 1. Scope

- Design: `D:\Personal\rolekit\.codestable\features\2026-07-24-evals-fixtures\evals-fixtures-design.md`
- Checklist: `D:\Personal\rolekit\.codestable\features\2026-07-24-evals-fixtures\evals-fixtures-checklist.yaml`

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
      "command": "npm test",
      "exit_code": 0,
      "stdout": "n success (382.6828ms)\n  ✔ help lists validate and run command surface (304.4192ms)\n✔ rolekit validate e2e (19558.4082ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (4090.4014ms)\n  ✔ steer returns unsupported_operation json (1689.5716ms)\n  ✔ usage errors exit 2 (872.2009ms)\n  ✔ in-place worktree rejected (607.3917ms)\n  ✔ cancel run rejects verify (2674.5897ms)\n  ✔ help lists run and verify (317.3138ms)\n✔ rolekit run/verify e2e (mock) (10251.9842ms)\n▶ rolekit gate CLI e2e\n  ✔ prefix routing: WI unavailable exit1, other prefix exit2 (1102.8739ms)\n  ✔ confirm → list → approve → completed; finished approve is no-op (3127.804ms)\n  ✔ no_pending_gate on finished minimal success (2077.588ms)\n  ✔ four checkpoint crash recovery: pre-await + resuming via status/list/collect/gate (6815.7821ms)\n  ✔ awaiting cancel keeps verification and does not integrate (2490.2728ms)\n✔ rolekit gate CLI e2e (15614.6405ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (7523.1864ms)\n  ✔ steer returns unsupported_operation json (2652.4187ms)\n  ✔ usage errors exit 2 (1457.3969ms)\n  ✔ in-place worktree rejected (1102.3052ms)\n  ✔ cancel run rejects verify (3943.7126ms)\n  ✔ help lists run and verify (498.5259ms)\n✔ rolekit run/verify e2e (mock) (17179.4533ms)\n▶ rolekit validate e2e\n  ✔ discovers fixtures for all 10 kinds (2.7757ms)\n  ✔ executor-profile/invalid-empty-adapter.yaml → exit 1 (561.1033ms)\n  ✔ executor-profile/invalid-missing-name.yaml → exit 1 (446.5196ms)\n  ✔ executor-profile/valid-openai-responses.yaml → exit 0 (890.8783ms)\n  ✔ executor-report/invalid-bad-status.yaml → exit 1 (657.1238ms)\n  ✔ executor-report/invalid-has-verification.yaml → exit 1 (669.3519ms)\n  ✔ executor-report/valid-blocked.yaml → exit 0 (497.7277ms)\n  ✔ gate-policy/invalid-bad-default.yaml → exit 1 (391.7611ms)\n  ✔ gate-policy/invalid-missing-trigger.yaml → exit 1 (753.6298ms)\n  ✔ gate-policy/valid-default.yaml → exit 0 (600.9105ms)\n  ✔ gate-record/invalid-bad-decision.json → exit 1 (562.2692ms)\n  ✔ gate-record/invalid-observe-with-resolution.json → exit 1 (555.3799ms)\n  ✔ gate-record/valid-observe.json → exit 0 (463.9364ms)\n  ✔ knowledge-entry/invalid-adr-missing-headings.md → exit 1 (554.6016ms)\n  ✔ knowledge-entry/invalid-missing-id.md → exit 1 (559.2868ms)\n  ✔ knowledge-entry/invalid-rule-multipart.md → exit 1 (586.479ms)\n  ✔ knowledge-entry/valid-adr-typescript.md → exit 0 (406.8048ms)\n  ✔ result-envelope/invalid-completed-with-violations.json → exit 1 (723.7629ms)\n  ✔ result-envelope/invalid-missing-task-id.json → exit 1 (459.9586ms)\n  ✔ result-envelope/valid-completed.json → exit 0 (523.8305ms)\n  ✔ role-profile/invalid-empty-name.yaml → exit 1 (425.6622ms)\n  ✔ role-profile/invalid-wrong-schema.yaml → exit 1 (537.6322ms)\n  ✔ role-profile/valid-implementer.yaml → exit 0 (524.7618ms)\n  ✔ run-event/invalid-missing-payload-field.json → exit 1 (478.1207ms)\n  ✔ run-event/invalid-unknown-type.json → exit 1 (355.7166ms)\n  ✔ run-event/valid-started.json → exit 0 (423.3672ms)\n  ✔ task-contract/invalid-empty-commands.yaml → exit 1 (481.3136ms)\n  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (547.1368ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (519.9403ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (452.5173ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (470.4791ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (367.612ms)\n  ✔ usage error: missing file → exit 2 (513.5068ms)\n  ✔ usage error: unknown flag → exit 2 (376.4458ms)\n  ✔ usage error: unknown command → exit 2 (378.6393ms)\n  ✔ parse_error for empty file (399.1836ms)\n  ✔ parse_error for UTF-8 BOM file (321.4469ms)\n  ✔ unknown_schema when schema field missing (322.165ms)\n  ✔ --json stdout is JSON only on success (371.1412ms)\n  ✔ help lists validate and run command surface (302.5103ms)\n✔ rolekit validate e2e (19441.8541ms)\nℹ tests 202\nℹ suites 38\nℹ pass 202\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 46356.6157\n",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run evals",
      "exit_code": 0,
      "stdout": "\n> rolekit@0.0.0 evals\n> node packages/evals/bin/evals.js\n\n{\n  \"verdict\": \"pass\",\n  \"runs\": [\n    {\n      \"name\": \"dogfood-cancelled\",\n      \"expectation\": \"cancelled\",\n      \"result\": {\n        \"contract\": \"pass\",\n        \"envelope\": {\n          \"validate\": \"pass\",\n          \"evidence_paths\": \"pass\",\n          \"pass\": true\n        },\n        \"scope\": \"skipped\"\n      }\n    },\n    {\n      \"name\": \"dogfood-clean-1\",\n      \"expectation\": \"clean\",\n      \"result\": {\n        \"contract\": \"pass\",\n        \"envelope\": {\n          \"validate\": \"pass\",\n          \"evidence_paths\": \"pass\",\n          \"pass\": true\n        },\n        \"scope\": {\n          \"detected\": false\n        }\n      }\n    },\n    {\n      \"name\": \"dogfood-clean-2\",\n      \"expectation\": \"clean\",\n      \"result\": {\n        \"contract\": \"pass\",\n        \"envelope\": {\n          \"validate\": \"pass\",\n          \"evidence_paths\": \"pass\",\n          \"pass\": true\n        },\n        \"scope\": {\n          \"detected\": false\n        }\n      }\n    },\n    {\n      \"name\": \"inject-concurrent\",\n      \"expectation\": \"violation\",\n      \"result\": {\n        \"contract\": \"pass\",\n        \"envelope\": {\n          \"validate\": \"pass\",\n          \"evidence_paths\": \"pass\",\n          \"pass\": true\n        },\n        \"scope\": {\n          \"detected\": true\n        }\n      }\n    },\n    {\n      \"name\": \"inject-forbidden\",\n      \"expectation\": \"violation\",\n      \"result\": {\n        \"contract\": \"pass\",\n        \"envelope\": {\n          \"validate\": \"pass\",\n          \"evidence_paths\": \"pass\",\n          \"pass\": true\n        },\n        \"scope\": {\n          \"detected\": true\n        }\n      }\n    }\n  ],\n  \"metrics\": {\n    \"contract_completeness\": {\n      \"passed\": 5,\n      \"total\": 5,\n      \"rate\": 1,\n      \"threshold\": 1,\n      \"pass\": true\n    },\n    \"envelope_completeness\": {\n      \"passed\": 5,\n      \"total\": 5,\n      \"rate\": 1,\n      \"threshold\": 1,\n      \"pass\": true\n    },\n    \"scope_detection\": {\n      \"passed\": 2,\n      \"total\": 2,\n      \"rate\": 1,\n      \"threshold\": 1,\n      \"pass\": true\n    },\n    \"scope_false_positives\": {\n      \"count\": 0,\n      \"threshold\": 0,\n      \"pass\": true\n    }\n  }\n}\n",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx tsc --noEmit && npx biome check .",
      "exit_code": 0,
      "stdout": "The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.\nDiagnostics not shown: 15.\nChecked 128 files in 85ms. No fixes applied.\nFound 35 warnings.\n",
      "stderr": "Exists<DetectPolicy>(join(runDirectory, 'detect-snapshot.json'))\n  \n\npackages\\runner\\src\\loaders.ts:272:18 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    270 │     join(runDirectory, 'executor-profile-snapshot.json'),\n    271 │   ))!\n  > 272 │   const policy = (await readJsonIfExists<GatePolicy>(join(runDirectory, 'policy-snapshot.json')))!\n        │                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    273 │   const detect = await readJsonIfExists<DetectPolicy>(join(runDirectory, 'detect-snapshot.json'))\n    274 │   return {\n  \n\npackages\\runner\\src\\run-supervisor.ts:105:15 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    103 │     // poll until finished / cancel / deadline\n    104 │     for (;;) {\n  > 105 │       state = (await readRunState(projectRoot, runId))!\n        │               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    106 │       if (\n    107 │         state.phase === 'terminal' ||\n  \n\npackages\\runner\\src\\run-supervisor.ts:124:17 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    122 │           termination_intent: { status: 'failed', reason: 'timeout' },\n    123 │         }))\n  > 124 │         state = (await readRunState(projectRoot, runId))!\n        │                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    125 │       }\n    126 │ \n  \n\npackages\\runner\\src\\semver-range.ts:49:9 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │         ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:49:19 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │                   ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:50:14 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │              ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\semver-range.ts:50:22 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │                      ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\worktree.ts:171:18 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    169 │   const out: Array<{ code: string; path: string }> = []\n    170 │   for (let i = 0; i < parts.length; i += 1) {\n  > 171 │     const part = parts[i]!\n        │                  ^^^^^^^^^\n    172 │     if (part.length < 3) {\n    173 │       continue\n  \n\npackages\\runner\\test\\unit\\jsonl-framing.test.ts:16:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    14 │     })\n    15 │     assert.equal(lines.length, 1)\n  > 16 │     assert.equal(JSON.parse(lines[0]!).text, 'a\\u2028b\\u2029c')\n       │                             ^^^^^^^^^\n    17 │   })\n    18 │ })\n  \n\npackages\\runner\\test\\unit\\pi-rpc-probe.test.ts:35:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    33 │     })\n    34 │     assert.equal(lines.length, 1)\n  > 35 │     assert.equal(JSON.parse(lines[0]!).text, 'x\\u2028y')\n       │                             ^^^^^^^^^\n    36 │   })\n    37 │ })\n  \n\n",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    }
  ],
  "providers": {},
  "feature": "2026-07-24-evals-fixtures",
  "inputs": {
    "checklist": ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-checklist.yaml"
  },
  "input_digests": {
    "checklist": "c2772b9cdf5fa9ab23f9d27a65a51e70b5e21e520c8cf6a35cd0dbdbc6e5388b"
  },
  "kind": "executable"
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 11063
Checklist bytes: 3728

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
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-checklist.yaml",
        ".github/workflows/ci.yml",
        "biome.json",
        "scripts/run-tests.ts",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-dod-contract-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-evidence-pack.md",
        "evals/seeds-negative/envelope-missing-unresolved/events.jsonl",
        "evals/seeds-negative/envelope-missing-unresolved/prompt.md",
        "evals/seeds-negative/envelope-missing-unresolved/result.json",
        "evals/seeds-negative/envelope-missing-unresolved/seed.yaml",
        "evals/seeds-negative/envelope-missing-unresolved/task.json",
        "evals/seeds-negative/envelope-missing-unresolved/verification.json",
        "evals/seeds-negative/evidence-missing-path/events.jsonl",
        "evals/seeds-negative/evidence-missing-path/prompt.md",
        "evals/seeds-negative/evidence-missing-path/result.json",
        "evals/seeds-negative/evidence-missing-path/seed.yaml",
        "evals/seeds-negative/evidence-missing-path/task.json",
        "evals/seeds-negative/evidence-missing-path/verification.json",
        "evals/seeds-negative/task-missing-field/events.jsonl",
        "evals/seeds-negative/task-missing-field/prompt.md",
        "evals/seeds-negative/task-missing-field/result.json",
        "evals/seeds-negative/task-missing-field/seed.yaml",
        "evals/seeds-negative/task-missing-field/task.json",
        "evals/seeds-negative/task-missing-field/verification.json",
        "evals/seeds-negative/violation-cleared-scope/events.jsonl",
        "evals/seeds-negative/violation-cleared-scope/prompt.md",
        "evals/seeds-negative/violation-cleared-scope/result.json",
        "evals/seeds-negative/violation-cleared-scope/seed.yaml",
        "evals/seeds-negative/violation-cleared-scope/task.json",
        "evals/seeds-negative/violation-cleared-scope/verification.json",
        "evals/seeds/dogfood-cancelled/events.jsonl",
        "evals/seeds/dogfood-cancelled/prompt.md",
        "evals/seeds/dogfood-cancelled/result.json",
        "evals/seeds/dogfood-cancelled/seed.yaml",
        "evals/seeds/dogfood-cancelled/task.json",
        "evals/seeds/dogfood-cancelled/verification.json",
        "evals/seeds/dogfood-clean-1/events.jsonl",
        "evals/seeds/dogfood-clean-1/prompt.md",
        "evals/seeds/dogfood-clean-1/result.json",
        "evals/seeds/dogfood-clean-1/seed.yaml",
        "evals/seeds/dogfood-clean-1/task.json",
        "evals/seeds/dogfood-clean-1/verification.json",
        "evals/seeds/dogfood-clean-2/events.jsonl",
        "evals/seeds/dogfood-clean-2/prompt.md",
        "evals/seeds/dogfood-clean-2/result.json",
        "evals/seeds/dogfood-clean-2/seed.yaml",
        "evals/seeds/dogfood-clean-2/task.json",
        "evals/seeds/dogfood-clean-2/verification.json",
        "evals/seeds/inject-concurrent/events.jsonl",
        "evals/seeds/inject-concurrent/prompt.md",
        "evals/seeds/inject-concurrent/result.json",
        "evals/seeds/inject-concurrent/seed.yaml",
        "evals/seeds/inject-concurrent/task.json",
        "evals/seeds/inject-concurrent/verification.json",
        "evals/seeds/inject-forbidden/events.jsonl",
        "evals/seeds/inject-forbidden/prompt.md",
        "evals/seeds/inject-forbidden/result.json",
        "evals/seeds/inject-forbidden/seed.yaml",
        "evals/seeds/inject-forbidden/task.json",
        "evals/seeds/inject-forbidden/verification.json",
        "packages/evals/bin/capture.js",
        "packages/evals/bin/evals.js",
        "packages/evals/package.json",
        "packages/evals/src/capture.ts",
        "packages/evals/src/cli-capture.ts",
        "packages/evals/src/cli-evals.ts",
        "packages/evals/src/evaluate.ts",
        "packages/evals/src/index.ts",
        "packages/evals/src/ledger.ts",
        "packages/evals/src/redact.ts",
        "packages/evals/src/types.ts",
        "packages/evals/test/cli.test.ts",
        "packages/evals/test/evaluate.test.ts",
        "packages/evals/test/fixtures/seeds-mock/mock-clean/events.jsonl",
        "packages/evals/test/fixtures/seeds-mock/mock-clean/prompt.md",
        "packages/evals/test/fixtures/seeds-mock/mock-clean/result.json",
        "packages/evals/test/fixtures/seeds-mock/mock-clean/seed.yaml",
        "packages/evals/test/fixtures/seeds-mock/mock-clean/task.json",
        "packages/evals/test/fixtures/seeds-mock/mock-clean/verification.json",
        "packages/evals/test/fixtures/seeds-mock/mock-violation/events.jsonl",
        "packages/evals/test/fixtures/seeds-mock/mock-violation/prompt.md",
        "packages/evals/test/fixtures/seeds-mock/mock-violation/result.json",
        "packages/evals/test/fixtures/seeds-mock/mock-violation/seed.yaml",
        "packages/evals/test/fixtures/seeds-mock/mock-violation/task.json",
        "packages/evals/test/fixtures/seeds-mock/mock-violation/verification.json",
        "packages/evals/test/helpers/sample-run.ts",
        "packages/evals/test/ledger.test.ts",
        "packages/evals/test/negative-metrics.test.ts",
        "packages/evals/test/redact-capture.test.ts",
        "packages/evals/test/seeds-hygiene.test.ts"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-24-evals-fixtures/2026-07-24-evals-fixtures-dod-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/2026-07-24-evals-fixtures-evidence-pack-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/2026-07-24-evals-fixtures-gate-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-dod-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-evidence-pack-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-gate-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-24-evals-fixtures",
        "packages/",
        "scripts/",
        "evidence/",
        "evals/",
        "fixtures/",
        ".codestable/",
        ".rolekit/",
        "test/",
        "package.json",
        "package-lock.json",
        ".github/",
        "biome.json",
        ".gitignore"
      ]
    }
  ],
  "providers": {},
  "feature": "2026-07-24-evals-fixtures",
  "inputs": {
    "feature_dir": ".codestable/features/2026-07-24-evals-fixtures"
  },
  "input_digests": {},
  "kind": "executable"
}
```
