---
doc_type: feature-evidence-pack
feature: 2026-07-24-verifier-gate-engine
status: generated
---

# 2026-07-24-verifier-gate-engine evidence pack

## 1. Scope

- Design: `D:\Personal\rolekit\.codestable\features\2026-07-24-verifier-gate-engine\verifier-gate-engine-design.md`
- Checklist: `D:\Personal\rolekit\.codestable\features\2026-07-24-verifier-gate-engine\verifier-gate-engine-checklist.yaml`

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
      "stdout": "only on success (368.6725ms)\n  ✔ help lists validate and run command surface (339.4704ms)\n✔ rolekit validate e2e (18902.4587ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (3311.2742ms)\n  ✔ steer returns unsupported_operation json (1703.5604ms)\n  ✔ usage errors exit 2 (865.1119ms)\n  ✔ in-place worktree rejected (541.7117ms)\n  ✔ cancel run rejects verify (2490.6015ms)\n  ✔ help lists run and verify (297.2441ms)\n✔ rolekit run/verify e2e (mock) (9209.9983ms)\n▶ rolekit gate CLI e2e\n  ✔ prefix routing: WI unavailable exit1, other prefix exit2 (1047.5679ms)\n  ✔ confirm → list → approve → completed; finished approve is no-op (3287.0594ms)\n  ✔ no_pending_gate on finished minimal success (1987.6951ms)\n  ✔ four checkpoint crash recovery: pre-await + resuming via status/list/collect/gate (6069.9241ms)\n  ✔ awaiting cancel keeps verification and does not integrate (2371.0273ms)\n✔ rolekit gate CLI e2e (14763.5635ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (5739.2556ms)\n  ✔ steer returns unsupported_operation json (3021.8205ms)\n  ✔ usage errors exit 2 (1659.3992ms)\n  ✔ in-place worktree rejected (999.639ms)\n  ✔ cancel run rejects verify (3919.8804ms)\n  ✔ help lists run and verify (438.6411ms)\n✔ rolekit run/verify e2e (mock) (15781.711ms)\n▶ rolekit validate e2e\n  ✔ discovers fixtures for all 10 kinds (2.3519ms)\n  ✔ executor-profile/invalid-empty-adapter.yaml → exit 1 (665.9786ms)\n  ✔ executor-profile/invalid-missing-name.yaml → exit 1 (594.243ms)\n  ✔ executor-profile/valid-openai-responses.yaml → exit 0 (580.259ms)\n  ✔ executor-report/invalid-bad-status.yaml → exit 1 (490.6548ms)\n  ✔ executor-report/invalid-has-verification.yaml → exit 1 (511.1981ms)\n  ✔ executor-report/valid-blocked.yaml → exit 0 (566.5776ms)\n  ✔ gate-policy/invalid-bad-default.yaml → exit 1 (563.5858ms)\n  ✔ gate-policy/invalid-missing-trigger.yaml → exit 1 (586.7305ms)\n  ✔ gate-policy/valid-default.yaml → exit 0 (592.454ms)\n  ✔ gate-record/invalid-bad-decision.json → exit 1 (480.043ms)\n  ✔ gate-record/invalid-observe-with-resolution.json → exit 1 (555.2289ms)\n  ✔ gate-record/valid-observe.json → exit 0 (516.5334ms)\n  ✔ knowledge-entry/invalid-adr-missing-headings.md → exit 1 (547.1742ms)\n  ✔ knowledge-entry/invalid-missing-id.md → exit 1 (575.4782ms)\n  ✔ knowledge-entry/invalid-rule-multipart.md → exit 1 (565.83ms)\n  ✔ knowledge-entry/valid-adr-typescript.md → exit 0 (644.4721ms)\n  ✔ result-envelope/invalid-completed-with-violations.json → exit 1 (596.0465ms)\n  ✔ result-envelope/invalid-missing-task-id.json → exit 1 (562.7514ms)\n  ✔ result-envelope/valid-completed.json → exit 0 (532.1128ms)\n  ✔ role-profile/invalid-empty-name.yaml → exit 1 (537.3823ms)\n  ✔ role-profile/invalid-wrong-schema.yaml → exit 1 (488.0354ms)\n  ✔ role-profile/valid-implementer.yaml → exit 0 (471.0802ms)\n  ✔ run-event/invalid-missing-payload-field.json → exit 1 (502.2365ms)\n  ✔ run-event/invalid-unknown-type.json → exit 1 (408.5367ms)\n  ✔ run-event/valid-started.json → exit 0 (351.9007ms)\n  ✔ task-contract/invalid-empty-commands.yaml → exit 1 (457.838ms)\n  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (472.0972ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (439.5271ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (457.6548ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (447.2793ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (375.1498ms)\n  ✔ usage error: missing file → exit 2 (313.4419ms)\n  ✔ usage error: unknown flag → exit 2 (413.5718ms)\n  ✔ usage error: unknown command → exit 2 (347.8082ms)\n  ✔ parse_error for empty file (359.9068ms)\n  ✔ parse_error for UTF-8 BOM file (347.3501ms)\n  ✔ unknown_schema when schema field missing (359.8048ms)\n  ✔ --json stdout is JSON only on success (350.5909ms)\n  ✔ help lists validate and run command surface (350.4203ms)\n✔ rolekit validate e2e (18985.5008ms)\nℹ tests 202\nℹ suites 38\nℹ pass 202\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 43750.9563\n",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "node --test test/e2e/",
      "exit_code": 0,
      "stdout": "▶ rolekit validate e2e\n  ✔ discovers fixtures for all 10 kinds (0.9732ms)\n  ✔ executor-profile/invalid-empty-adapter.yaml → exit 1 (258.5904ms)\n  ✔ executor-profile/invalid-missing-name.yaml → exit 1 (261.1882ms)\n  ✔ executor-profile/valid-openai-responses.yaml → exit 0 (267.3375ms)\n  ✔ executor-report/invalid-bad-status.yaml → exit 1 (278.8274ms)\n  ✔ executor-report/invalid-has-verification.yaml → exit 1 (289.8878ms)\n  ✔ executor-report/valid-blocked.yaml → exit 0 (303.4856ms)\n  ✔ gate-policy/invalid-bad-default.yaml → exit 1 (270.5705ms)\n  ✔ gate-policy/invalid-missing-trigger.yaml → exit 1 (292.3405ms)\n  ✔ gate-policy/valid-default.yaml → exit 0 (281.1444ms)\n  ✔ gate-record/invalid-bad-decision.json → exit 1 (290.6887ms)\n  ✔ gate-record/invalid-observe-with-resolution.json → exit 1 (261.4545ms)\n  ✔ gate-record/valid-observe.json → exit 0 (264.9391ms)\n  ✔ knowledge-entry/invalid-adr-missing-headings.md → exit 1 (282.4486ms)\n  ✔ knowledge-entry/invalid-missing-id.md → exit 1 (287.8545ms)\n  ✔ knowledge-entry/invalid-rule-multipart.md → exit 1 (285.7017ms)\n  ✔ knowledge-entry/valid-adr-typescript.md → exit 0 (267.3607ms)\n  ✔ result-envelope/invalid-completed-with-violations.json → exit 1 (270.5432ms)\n  ✔ result-envelope/invalid-missing-task-id.json → exit 1 (270.7928ms)\n  ✔ result-envelope/valid-completed.json → exit 0 (268.1365ms)\n  ✔ role-profile/invalid-empty-name.yaml → exit 1 (281.3086ms)\n  ✔ role-profile/invalid-wrong-schema.yaml → exit 1 (308.9903ms)\n  ✔ role-profile/valid-implementer.yaml → exit 0 (296.0504ms)\n  ✔ run-event/invalid-missing-payload-field.json → exit 1 (263.139ms)\n  ✔ run-event/invalid-unknown-type.json → exit 1 (229.6862ms)\n  ✔ run-event/valid-started.json → exit 0 (228.8976ms)\n  ✔ task-contract/invalid-empty-commands.yaml → exit 1 (276.7693ms)\n  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (264.5072ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (279.9172ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (273.3428ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (302.0334ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (287.567ms)\n  ✔ usage error: missing file → exit 2 (223.2664ms)\n  ✔ usage error: unknown flag → exit 2 (229.8997ms)\n  ✔ usage error: unknown command → exit 2 (253.0529ms)\n  ✔ parse_error for empty file (259.3134ms)\n  ✔ parse_error for UTF-8 BOM file (282.3791ms)\n  ✔ unknown_schema when schema field missing (310.495ms)\n  ✔ --json stdout is JSON only on success (267.6181ms)\n  ✔ help lists validate and run command surface (270.5974ms)\n✔ rolekit validate e2e (10645.6397ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (2866.4977ms)\n  ✔ steer returns unsupported_operation json (1534.9092ms)\n  ✔ usage errors exit 2 (977.9279ms)\n  ✔ in-place worktree rejected (521.5381ms)\n  ✔ cancel run rejects verify (2419.1135ms)\n  ✔ help lists run and verify (270.5722ms)\n✔ rolekit run/verify e2e (mock) (8590.933ms)\n▶ rolekit gate CLI e2e\n  ✔ prefix routing: WI unavailable exit1, other prefix exit2 (859.2284ms)\n  ✔ confirm → list → approve → completed; finished approve is no-op (3022.6513ms)\n  ✔ no_pending_gate on finished minimal success (2120.0751ms)\n  ✔ four checkpoint crash recovery: pre-await + resuming via status/list/collect/gate (6222.9468ms)\n  ✔ awaiting cancel keeps verification and does not integrate (2664.1501ms)\n✔ rolekit gate CLI e2e (14889.4165ms)\nℹ tests 51\nℹ suites 3\nℹ pass 51\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 34264.0014\n",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx tsc --noEmit && npx biome check .",
      "exit_code": 0,
      "stdout": "The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.\nDiagnostics not shown: 15.\nChecked 128 files in 74ms. No fixes applied.\nFound 35 warnings.\n",
      "stderr": "Exists<DetectPolicy>(join(runDirectory, 'detect-snapshot.json'))\n  \n\npackages\\runner\\src\\loaders.ts:272:18 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    270 │     join(runDirectory, 'executor-profile-snapshot.json'),\n    271 │   ))!\n  > 272 │   const policy = (await readJsonIfExists<GatePolicy>(join(runDirectory, 'policy-snapshot.json')))!\n        │                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    273 │   const detect = await readJsonIfExists<DetectPolicy>(join(runDirectory, 'detect-snapshot.json'))\n    274 │   return {\n  \n\npackages\\runner\\src\\run-supervisor.ts:105:15 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    103 │     // poll until finished / cancel / deadline\n    104 │     for (;;) {\n  > 105 │       state = (await readRunState(projectRoot, runId))!\n        │               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    106 │       if (\n    107 │         state.phase === 'terminal' ||\n  \n\npackages\\runner\\src\\run-supervisor.ts:124:17 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    122 │           termination_intent: { status: 'failed', reason: 'timeout' },\n    123 │         }))\n  > 124 │         state = (await readRunState(projectRoot, runId))!\n        │                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    125 │       }\n    126 │ \n  \n\npackages\\runner\\src\\semver-range.ts:49:9 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │         ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:49:19 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │                   ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:50:14 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │              ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\semver-range.ts:50:22 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │                      ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\worktree.ts:171:18 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    169 │   const out: Array<{ code: string; path: string }> = []\n    170 │   for (let i = 0; i < parts.length; i += 1) {\n  > 171 │     const part = parts[i]!\n        │                  ^^^^^^^^^\n    172 │     if (part.length < 3) {\n    173 │       continue\n  \n\npackages\\runner\\test\\unit\\jsonl-framing.test.ts:16:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    14 │     })\n    15 │     assert.equal(lines.length, 1)\n  > 16 │     assert.equal(JSON.parse(lines[0]!).text, 'a\\u2028b\\u2029c')\n       │                             ^^^^^^^^^\n    17 │   })\n    18 │ })\n  \n\npackages\\runner\\test\\unit\\pi-rpc-probe.test.ts:35:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    33 │     })\n    34 │     assert.equal(lines.length, 1)\n  > 35 │     assert.equal(JSON.parse(lines[0]!).text, 'x\\u2028y')\n       │                             ^^^^^^^^^\n    36 │   })\n    37 │ })\n  \n\n",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "node scripts/verifier-validate-artifacts.mjs",
      "exit_code": 0,
      "stdout": "evidence/verifier-gate-engine/observe/task.json ok {\"valid\":true,\"schema\":\"rolekit/task-contract@1\"}\nevidence/verifier-gate-engine/observe/result.json ok {\"valid\":true,\"schema\":\"rolekit/result-envelope@1\"}\nevidence/verifier-gate-engine/observe/gates.json ok {\"valid\":true,\"schema\":\"rolekit/gate-record@1\"}\nevidence/verifier-gate-engine/observe/policy-snapshot.json ok {\"valid\":true,\"schema\":\"rolekit/gate-policy@1\"}\nevidence/verifier-gate-engine/scope-block/task.json ok {\"valid\":true,\"schema\":\"rolekit/task-contract@1\"}\nevidence/verifier-gate-engine/scope-block/result.json ok {\"valid\":true,\"schema\":\"rolekit/result-envelope@1\"}\nevidence/verifier-gate-engine/scope-block/gates.json ok {\"valid\":true,\"schema\":\"rolekit/gate-record@1\"}\nfixtures/gate-record/valid-observe.json ok {\"valid\":true,\"schema\":\"rolekit/gate-record@1\"}\nfixtures/gate-record/invalid-bad-decision.json invalid-as-expected\nfixtures/gate-record/invalid-observe-with-resolution.json invalid-as-expected\n",
      "stderr": "",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block"
    }
  ],
  "providers": {},
  "feature": "2026-07-24-verifier-gate-engine",
  "inputs": {
    "checklist": ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-checklist.yaml"
  },
  "input_digests": {
    "checklist": "de8f7ee291ab42846a8da82aaa02397854b7a338d52ada93ea2a3b76c549679c"
  },
  "kind": "executable"
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 23553
Checklist bytes: 5086

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
        ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-checklist.yaml",
        ".codestable/requirements/adrs/003-auto-flow-gate-whitelist.md",
        ".codestable/roadmap/rolekit-v2/goal-state.yaml",
        ".github/workflows/ci.yml",
        "biome.json",
        "evidence/role-profiles-migration/project",
        "packages/cli/src/cli.ts",
        "packages/core/src/index.ts",
        "packages/core/src/schema-registry.ts",
        "packages/core/src/schemas/index.ts",
        "packages/core/src/schemas/shared.ts",
        "packages/core/test/schemas.test.ts",
        "packages/runner/src/executors/mock.ts",
        "packages/runner/src/index.ts",
        "packages/runner/src/loaders.ts",
        "packages/runner/src/run-manager.ts",
        "packages/runner/src/run-state-store.ts",
        "packages/runner/src/types.ts",
        "scripts/run-tests.ts",
        "test/adapters/check-delegated-run.test.ts",
        "test/e2e/load-all.test.ts",
        "test/e2e/validate-cli.test.ts",
        ".codestable/compound/verifier-gate-engine-absorption.md",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-dod-contract-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-evidence-pack.md",
        ".codestable/features/2026-07-24-verifier-gate-engine/absorption-inventory.md",
        ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-dod-contract-results.json",
        ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-evidence-pack.md",
        ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-review.md",
        ".rolekit/policies/examples/acceptance-observe.yaml",
        ".rolekit/policies/examples/detect-default.yaml",
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
        "evidence/role-profiles-migration/project/.gitignore",
        "evidence/role-profiles-migration/project/.rolekit/profiles/executors/pi.yaml",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/analyst/core.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/architect/core.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/coordinator/core.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/implementer/backend.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/implementer/core.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/implementer/frontend.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/qa/core.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/researcher/core.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/fragments/reviewer/core.md",
        "evidence/role-profiles-migration/project/.rolekit/profiles/roles/analyst.yaml",
        "evidence/role-profiles-migration/project/.rolekit/profiles/roles/architect.yaml",
        "evidence/role-profiles-migration/project/.rolekit/profiles/roles/coordinator.yaml",
        "evidence/role-profiles-migration/project/.rolekit/profiles/roles/implementer.yaml",
        "evidence/role-profiles-migration/project/.rolekit/profiles/roles/qa.yaml",
        "evidence/role-profiles-migration/project/.rolekit/profiles/roles/researcher.yaml",
        "evidence/role-profiles-migration/project/.rolekit/profiles/roles/reviewer.yaml",
        "evidence/role-profiles-migration/project/docs/research-notes.md",
        "evidence/role-profiles-migration/project/docs/review-report.md",
        "evidence/role-profiles-migration/project/docs/review-subject.md",
        "evidence/role-profiles-migration/project/src/profile-implementer.txt",
        "evidence/role-profiles-migration/project/src/seed.txt",
        "evidence/role-profiles-migration/project/tasks/RK-PROF-IMPL-20260728101913.yaml",
        "evidence/role-profiles-migration/project/tasks/RK-PROF-RES-20260728101913.yaml",
        "evidence/role-profiles-migration/project/tasks/RK-PROF-REV-20260728101913.yaml",
        "evidence/verifier-gate-engine/LIVE.md",
        "evidence/verifier-gate-engine/SUMMARY.md",
        "evidence/verifier-gate-engine/observe/RESULT.md",
        "evidence/verifier-gate-engine/observe/artifacts/change-manifest.json",
        "evidence/verifier-gate-engine/observe/artifacts/executor-report.json",
        "evidence/verifier-gate-engine/observe/baseline.json",
        "evidence/verifier-gate-engine/observe/detect-snapshot.json",
        "evidence/verifier-gate-engine/observe/events.jsonl",
        "evidence/verifier-gate-engine/observe/gates.json",
        "evidence/verifier-gate-engine/observe/policy-snapshot.json",
        "evidence/verifier-gate-engine/observe/prompt.md",
        "evidence/verifier-gate-engine/observe/result.json",
        "evidence/verifier-gate-engine/observe/run-state.json",
        "evidence/verifier-gate-engine/observe/summary.json",
        "evidence/verifier-gate-engine/observe/task.json",
        "evidence/verifier-gate-engine/observe/verification.json",
        "evidence/verifier-gate-engine/scope-block/RESULT.md",
        "evidence/verifier-gate-engine/scope-block/artifacts/executor-report.json",
        "evidence/verifier-gate-engine/scope-block/baseline.json",
        "evidence/verifier-gate-engine/scope-block/detect-snapshot.json",
        "evidence/verifier-gate-engine/scope-block/events.jsonl",
        "evidence/verifier-gate-engine/scope-block/gates.json",
        "evidence/verifier-gate-engine/scope-block/policy-snapshot.json",
        "evidence/verifier-gate-engine/scope-block/prompt.md",
        "evidence/verifier-gate-engine/scope-block/result.json",
        "evidence/verifier-gate-engine/scope-block/run-state.json",
        "evidence/verifier-gate-engine/scope-block/summary.json",
        "evidence/verifier-gate-engine/scope-block/task.json",
        "evidence/verifier-gate-engine/scope-block/verification.json",
        "fixtures/gate-record/invalid-bad-decision.json",
        "fixtures/gate-record/invalid-observe-with-resolution.json",
        "fixtures/gate-record/valid-observe.json",
        "packages/core/src/gate/policy-engine.ts",
        "packages/core/src/schemas/gate-record.ts",
        "packages/core/test/policy-engine.test.ts",
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
        "packages/evals/test/seeds-hygiene.test.ts",
        "packages/runner/src/gate/change-manifest.ts",
        "packages/runner/src/gate/detect-policy.ts",
        "packages/runner/src/gate/detectors.ts",
        "packages/runner/src/gate/gate-evaluation-pipeline.ts",
        "packages/runner/src/gate/gate-events.ts",
        "packages/runner/src/gate/gates-store.ts",
        "packages/runner/test/unit/detectors.test.ts",
        "packages/runner/test/unit/gate-pipeline.test.ts",
        "scripts/verifier-acceptance-observe.mjs",
        "scripts/verifier-acceptance-scope-block.mjs",
        "scripts/verifier-live-acceptance.ts",
        "scripts/verifier-validate-artifacts.mjs",
        "test/adapters/mjs-shims.d.ts",
        "test/e2e/gate-cli.test.ts"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-24-evals-fixtures/2026-07-24-evals-fixtures-dod-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/2026-07-24-evals-fixtures-evidence-pack-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/2026-07-24-evals-fixtures-gate-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-dod-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-evidence-pack-results.json",
        ".codestable/features/2026-07-24-evals-fixtures/evals-fixtures-gate-results.json",
        ".codestable/features/2026-07-24-verifier-gate-engine/2026-07-24-verifier-gate-engine-dod-results.json",
        ".codestable/features/2026-07-24-verifier-gate-engine/2026-07-24-verifier-gate-engine-evidence-pack-results.json",
        ".codestable/features/2026-07-24-verifier-gate-engine/2026-07-24-verifier-gate-engine-gate-results.json",
        ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-dod-results.json",
        ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-evidence-pack-results.json",
        ".codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-gate-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-24-verifier-gate-engine",
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
  "feature": "2026-07-24-verifier-gate-engine",
  "inputs": {
    "feature_dir": ".codestable/features/2026-07-24-verifier-gate-engine"
  },
  "input_digests": {},
  "kind": "executable"
}
```
