---
doc_type: feature-evidence-pack
feature: 2026-07-24-pi-rpc-vertical-slice
status: generated
---

# 2026-07-24-pi-rpc-vertical-slice evidence pack

## 1. Scope

- Design: `D:\Personal\rolekit\.codestable\features\2026-07-24-pi-rpc-vertical-slice\pi-rpc-vertical-slice-design.md`
- Checklist: `D:\Personal\rolekit\.codestable\features\2026-07-24-pi-rpc-vertical-slice\pi-rpc-vertical-slice-checklist.yaml`

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
      "stdout": "  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (732.3787ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (608.1387ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (450.1462ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (435.0402ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (354.384ms)\n  ✔ usage error: missing file → exit 2 (330.1535ms)\n  ✔ usage error: unknown flag → exit 2 (323.45ms)\n  ✔ usage error: unknown command → exit 2 (332.418ms)\n  ✔ parse_error for empty file (379.0347ms)\n  ✔ parse_error for UTF-8 BOM file (419.6367ms)\n  ✔ unknown_schema when schema field missing (360.6751ms)\n  ✔ --json stdout is JSON only on success (333.9236ms)\n  ✔ help lists validate and run command surface (299.0933ms)\n✔ rolekit validate e2e (17502.9849ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (3992.6128ms)\n  ✔ steer returns unsupported_operation json (1806.8974ms)\n  ✔ usage errors exit 2 (1315.6246ms)\n  ✔ in-place worktree rejected (1048.0447ms)\n  ✔ cancel run rejects verify (3509.0107ms)\n  ✔ help lists run and verify (308.3102ms)\n✔ rolekit run/verify e2e (mock) (11980.9935ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (4803.4685ms)\n  ✔ steer returns unsupported_operation json (2116.0412ms)\n  ✔ usage errors exit 2 (1436.9782ms)\n  ✔ in-place worktree rejected (1628.2297ms)\n  ✔ cancel run rejects verify (5253.3005ms)\n  ✔ help lists run and verify (334.1825ms)\n✔ rolekit run/verify e2e (mock) (15574.4151ms)\n▶ rolekit validate e2e\n  ✔ discovers fixtures for all 9 kinds (2.6871ms)\n  ✔ executor-profile/invalid-empty-adapter.yaml → exit 1 (550.6599ms)\n  ✔ executor-profile/invalid-missing-name.yaml → exit 1 (463.6212ms)\n  ✔ executor-profile/valid-openai-responses.yaml → exit 0 (478.4185ms)\n  ✔ executor-report/invalid-bad-status.yaml → exit 1 (497.7591ms)\n  ✔ executor-report/invalid-has-verification.yaml → exit 1 (422.8666ms)\n  ✔ executor-report/valid-blocked.yaml → exit 0 (422.1734ms)\n  ✔ gate-policy/invalid-bad-default.yaml → exit 1 (384.8243ms)\n  ✔ gate-policy/invalid-missing-trigger.yaml → exit 1 (390.0669ms)\n  ✔ gate-policy/valid-default.yaml → exit 0 (439.1251ms)\n  ✔ knowledge-entry/invalid-adr-missing-headings.md → exit 1 (472.5738ms)\n  ✔ knowledge-entry/invalid-missing-id.md → exit 1 (429.3314ms)\n  ✔ knowledge-entry/invalid-rule-multipart.md → exit 1 (482.7427ms)\n  ✔ knowledge-entry/valid-adr-typescript.md → exit 0 (454.2526ms)\n  ✔ result-envelope/invalid-completed-with-violations.json → exit 1 (446.4068ms)\n  ✔ result-envelope/invalid-missing-task-id.json → exit 1 (411.3822ms)\n  ✔ result-envelope/valid-completed.json → exit 0 (422.6406ms)\n  ✔ role-profile/invalid-empty-name.yaml → exit 1 (485.3666ms)\n  ✔ role-profile/invalid-wrong-schema.yaml → exit 1 (411.0659ms)\n  ✔ role-profile/valid-implementer.yaml → exit 0 (691.1612ms)\n  ✔ run-event/invalid-missing-payload-field.json → exit 1 (700.6953ms)\n  ✔ run-event/invalid-unknown-type.json → exit 1 (561.4287ms)\n  ✔ run-event/valid-started.json → exit 0 (401.6206ms)\n  ✔ task-contract/invalid-empty-commands.yaml → exit 1 (568.9556ms)\n  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (1047.4238ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (698.659ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (650.275ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (463.1349ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (480.5593ms)\n  ✔ usage error: missing file → exit 2 (345.4581ms)\n  ✔ usage error: unknown flag → exit 2 (331.0297ms)\n  ✔ usage error: unknown command → exit 2 (332.7685ms)\n  ✔ parse_error for empty file (326.8477ms)\n  ✔ parse_error for UTF-8 BOM file (381.2901ms)\n  ✔ unknown_schema when schema field missing (406.0436ms)\n  ✔ --json stdout is JSON only on success (368.014ms)\n  ✔ help lists validate and run command surface (316.4682ms)\n✔ rolekit validate e2e (17144.0523ms)\nℹ tests 130\nℹ suites 22\nℹ pass 130\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 29922.4633\n",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx tsc --noEmit",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx biome check .",
      "exit_code": 0,
      "stdout": "The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.\nDiagnostics not shown: 5.\nChecked 77 files in 47ms. No fixes applied.\nFound 25 warnings.\n",
      "stderr": "= await readRunState(this.projectRoot, latest.run_id)\n    507 │     const terminal = latestState?.phase === 'terminal' ? latestState.terminal_status : null\n  \n\npackages\\runner\\src\\run-manager.ts:660:19 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    658 │       }\n    659 │ \n  > 660 │       let state = (await readRunState(this.projectRoot, runId))!\n        │                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    661 │       const report = await readJsonIfExists<import('@rolekit/core').ExecutorReport>(\n    662 │         join(dir, 'artifacts', 'executor-report.json'),\n  \n\npackages\\runner\\src\\run-supervisor.ts:105:15 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    103 │     // poll until finished / cancel / deadline\n    104 │     for (;;) {\n  > 105 │       state = (await readRunState(projectRoot, runId))!\n        │               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    106 │       if (\n    107 │         state.phase === 'terminal' ||\n  \n\npackages\\runner\\src\\run-supervisor.ts:124:17 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    122 │           termination_intent: { status: 'failed', reason: 'timeout' },\n    123 │         }))\n  > 124 │         state = (await readRunState(projectRoot, runId))!\n        │                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    125 │       }\n    126 │ \n  \n\npackages\\runner\\src\\semver-range.ts:49:9 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │         ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:49:19 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    47 │ function compare(a: [number, number, number], b: [number, number, number]): number {\n    48 │   for (let i = 0; i < 3; i += 1) {\n  > 49 │     if (a[i]! !== b[i]!) {\n       │                   ^^^^^\n    50 │       return a[i]! - b[i]!\n    51 │     }\n  \n\npackages\\runner\\src\\semver-range.ts:50:14 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │              ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\semver-range.ts:50:22 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    48 │   for (let i = 0; i < 3; i += 1) {\n    49 │     if (a[i]! !== b[i]!) {\n  > 50 │       return a[i]! - b[i]!\n       │                      ^^^^^\n    51 │     }\n    52 │   }\n  \n\npackages\\runner\\src\\worktree.ts:171:18 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    169 │   const out: Array<{ code: string; path: string }> = []\n    170 │   for (let i = 0; i < parts.length; i += 1) {\n  > 171 │     const part = parts[i]!\n        │                  ^^^^^^^^^\n    172 │     if (part.length < 3) {\n    173 │       continue\n  \n\npackages\\runner\\test\\unit\\jsonl-framing.test.ts:16:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    14 │     })\n    15 │     assert.equal(lines.length, 1)\n  > 16 │     assert.equal(JSON.parse(lines[0]!).text, 'a\\u2028b\\u2029c')\n       │                             ^^^^^^^^^\n    17 │   })\n    18 │ })\n  \n\npackages\\runner\\test\\unit\\pi-rpc-probe.test.ts:35:29 lint/style/noNonNullAssertion ━━━━━━━━━━━━━━━━━\n\n  ! Forbidden non-null assertion.\n  \n    33 │     })\n    34 │     assert.equal(lines.length, 1)\n  > 35 │     assert.equal(JSON.parse(lines[0]!).text, 'x\\u2028y')\n       │                             ^^^^^^^^^\n    36 │   })\n    37 │ })\n  \n\n",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "node --test test/e2e/",
      "exit_code": 0,
      "stdout": "▶ rolekit validate e2e\n  ✔ discovers fixtures for all 9 kinds (0.8853ms)\n  ✔ executor-profile/invalid-empty-adapter.yaml → exit 1 (261.1801ms)\n  ✔ executor-profile/invalid-missing-name.yaml → exit 1 (249.0887ms)\n  ✔ executor-profile/valid-openai-responses.yaml → exit 0 (264.8254ms)\n  ✔ executor-report/invalid-bad-status.yaml → exit 1 (230.7778ms)\n  ✔ executor-report/invalid-has-verification.yaml → exit 1 (236.6644ms)\n  ✔ executor-report/valid-blocked.yaml → exit 0 (247.9374ms)\n  ✔ gate-policy/invalid-bad-default.yaml → exit 1 (232.7606ms)\n  ✔ gate-policy/invalid-missing-trigger.yaml → exit 1 (245.1659ms)\n  ✔ gate-policy/valid-default.yaml → exit 0 (285.4866ms)\n  ✔ knowledge-entry/invalid-adr-missing-headings.md → exit 1 (285.9748ms)\n  ✔ knowledge-entry/invalid-missing-id.md → exit 1 (276.9397ms)\n  ✔ knowledge-entry/invalid-rule-multipart.md → exit 1 (256.6278ms)\n  ✔ knowledge-entry/valid-adr-typescript.md → exit 0 (246.8593ms)\n  ✔ result-envelope/invalid-completed-with-violations.json → exit 1 (238.1272ms)\n  ✔ result-envelope/invalid-missing-task-id.json → exit 1 (244.6302ms)\n  ✔ result-envelope/valid-completed.json → exit 0 (237.9112ms)\n  ✔ role-profile/invalid-empty-name.yaml → exit 1 (233.2114ms)\n  ✔ role-profile/invalid-wrong-schema.yaml → exit 1 (241.1943ms)\n  ✔ role-profile/valid-implementer.yaml → exit 0 (243.1169ms)\n  ✔ run-event/invalid-missing-payload-field.json → exit 1 (236.3274ms)\n  ✔ run-event/invalid-unknown-type.json → exit 1 (299.4859ms)\n  ✔ run-event/valid-started.json → exit 0 (327.4788ms)\n  ✔ task-contract/invalid-empty-commands.yaml → exit 1 (337.3596ms)\n  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (281.0117ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (263.344ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (272.6351ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (273.055ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (264.8965ms)\n  ✔ usage error: missing file → exit 2 (285.8479ms)\n  ✔ usage error: unknown flag → exit 2 (387.6686ms)\n  ✔ usage error: unknown command → exit 2 (291.7818ms)\n  ✔ parse_error for empty file (270.6121ms)\n  ✔ parse_error for UTF-8 BOM file (282.953ms)\n  ✔ unknown_schema when schema field missing (292.4245ms)\n  ✔ --json stdout is JSON only on success (291.1914ms)\n  ✔ help lists validate and run command surface (296.2895ms)\n✔ rolekit validate e2e (9716.2434ms)\n▶ rolekit run/verify e2e (mock)\n  ✔ run start mock success + verify reverify artifact (3825.2291ms)\n  ✔ steer returns unsupported_operation json (1694.676ms)\n  ✔ usage errors exit 2 (907.5323ms)\n  ✔ in-place worktree rejected (586.1511ms)\n  ✔ cancel run rejects verify (2514.7768ms)\n  ✔ help lists run and verify (276.0715ms)\n✔ rolekit run/verify e2e (mock) (9804.8507ms)\nℹ tests 43\nℹ suites 2\nℹ pass 43\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 19678.3972\n",
      "stderr": "",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "node scripts/verify-dogfood-run.ts",
      "exit_code": 0,
      "stdout": "{\"id\":\"run-20260728-083328-7678\",\"reverify\":\"D:\\\\Personal\\\\rolekit\\\\evidence\\\\pi-rpc-vertical-slice\\\\dogfood\\\\project\\\\.rolekit\\\\runs\\\\run-20260728-083328-7678\\\\artifacts\\\\reverify-2026-07-28T09-20-30-325Z.json\"}\nverify run-20260728-083328-7678: passed=true\n{\"id\":\"run-20260728-083359-a14d\",\"reverify\":\"D:\\\\Personal\\\\rolekit\\\\evidence\\\\pi-rpc-vertical-slice\\\\dogfood\\\\project\\\\.rolekit\\\\runs\\\\run-20260728-083359-a14d\\\\artifacts\\\\reverify-2026-07-28T09-20-31-519Z.json\"}\nverify run-20260728-083359-a14d: passed=true\n",
      "stderr": "",
      "id": "CMD-005",
      "core": true,
      "failure_handling": "fix-or-block"
    }
  ],
  "providers": {},
  "feature": "2026-07-24-pi-rpc-vertical-slice",
  "inputs": {
    "checklist": ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-checklist.yaml"
  },
  "input_digests": {
    "checklist": "ee7caec6b5bfbfe63decff6ebb40d76ef3ce83c4d79bb88497b2226a84b6e81e"
  },
  "kind": "executable"
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 30808
Checklist bytes: 6372

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
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-checklist.yaml",
        ".codestable/roadmap/rolekit-v2/goal-state.yaml",
        ".codestable/roadmap/rolekit-v2/rolekit-v2-items.yaml",
        ".codestable/roadmap/rolekit-v2/rolekit-v2-roadmap.md",
        ".gitignore",
        "biome.json",
        "package-lock.json",
        "packages/cli/package.json",
        "packages/cli/src/cli.ts",
        "packages/core/src/index.ts",
        "scripts/run-tests.ts",
        "test/e2e/package.json",
        "test/e2e/validate-cli.test.ts",
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-dod-contract-results.json",
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-evidence-pack.md",
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-review.md",
        "packages/cli/src/project.ts",
        "packages/core/src/compile-prompt.ts",
        "packages/core/test/compile-prompt.test.ts",
        "packages/runner/bin/supervisor.js",
        "packages/runner/package.json",
        "packages/runner/src/adapter.ts",
        "packages/runner/src/canonical-json.ts",
        "packages/runner/src/empty-verification.ts",
        "packages/runner/src/errors.ts",
        "packages/runner/src/events.ts",
        "packages/runner/src/executors/mock.ts",
        "packages/runner/src/executors/pi-rpc.ts",
        "packages/runner/src/fs-util.ts",
        "packages/runner/src/glob.ts",
        "packages/runner/src/index.ts",
        "packages/runner/src/integration-manager.ts",
        "packages/runner/src/jsonl-framing.ts",
        "packages/runner/src/loaders.ts",
        "packages/runner/src/lock.ts",
        "packages/runner/src/project-root.ts",
        "packages/runner/src/registry.ts",
        "packages/runner/src/reservation-store.ts",
        "packages/runner/src/run-manager.ts",
        "packages/runner/src/run-state-store.ts",
        "packages/runner/src/run-supervisor.ts",
        "packages/runner/src/semver-range.ts",
        "packages/runner/src/supervisor-main.ts",
        "packages/runner/src/supervisor-spawn.ts",
        "packages/runner/src/types.ts",
        "packages/runner/src/verifier.ts",
        "packages/runner/src/worktree.ts",
        "packages/runner/test/fixtures/project/.rolekit/policies/gates.yaml",
        "packages/runner/test/fixtures/project/.rolekit/profiles/executors/mock-leak.yaml",
        "packages/runner/test/fixtures/project/.rolekit/profiles/executors/mock.yaml",
        "packages/runner/test/fixtures/project/.rolekit/profiles/executors/pi.yaml",
        "packages/runner/test/fixtures/project/.rolekit/profiles/fragments/minimal-safety.md",
        "packages/runner/test/fixtures/project/.rolekit/profiles/roles/minimal-implementer.yaml",
        "packages/runner/test/fixtures/project/.rolekit/rolekit.yaml",
        "packages/runner/test/fixtures/project/package.json",
        "packages/runner/test/fixtures/project/src/seed.txt",
        "packages/runner/test/fixtures/tasks/mock-forbidden.yaml",
        "packages/runner/test/fixtures/tasks/mock-success.yaml",
        "packages/runner/test/helpers/temp-project.ts",
        "packages/runner/test/unit/canonical-json.test.ts",
        "packages/runner/test/unit/finalizer-races.test.ts",
        "packages/runner/test/unit/jsonl-framing.test.ts",
        "packages/runner/test/unit/pi-rpc-probe.test.ts",
        "packages/runner/test/unit/registry.test.ts",
        "packages/runner/test/unit/run-manager-mock.test.ts",
        "scripts/dogfood-harness.ts",
        "scripts/pi-inject-harness.ts",
        "scripts/pi-rpc-smoke.ts",
        "scripts/verify-dogfood-run.ts",
        "test/e2e/load-all.test.ts",
        "test/e2e/run-cli.test.ts"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-dod-results.json",
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-evidence-pack-results.json",
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-gate-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-24-pi-rpc-vertical-slice",
        "packages/",
        "scripts/",
        "test/",
        "evidence/",
        ".codestable/",
        "package.json",
        "package-lock.json",
        ".gitignore",
        "biome.json"
      ]
    }
  ],
  "providers": {},
  "feature": "2026-07-24-pi-rpc-vertical-slice",
  "inputs": {
    "feature_dir": ".codestable/features/2026-07-24-pi-rpc-vertical-slice"
  },
  "input_digests": {},
  "kind": "executable"
}
```
