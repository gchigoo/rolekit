---
doc_type: feature-evidence-pack
feature: 2026-07-24-contract-schemas
status: generated
---

# 2026-07-24-contract-schemas evidence pack

## 1. Scope

- Design: `D:\Personal\rolekit\.codestable\features\2026-07-24-contract-schemas\contract-schemas-design.md`
- Checklist: `D:\Personal\rolekit\.codestable\features\2026-07-24-contract-schemas\contract-schemas-checklist.yaml`

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
      "stdout": "vent variants (3.5151ms)\n  ✔ rejects unknown event type (1.0502ms)\n✔ RunEvent discriminated union (4.7404ms)\n▶ WorkItem structure\n  ✔ accepts kind=goal (1.1508ms)\n  ✔ rejects unknown kind (0.6505ms)\n✔ WorkItem structure (2.0073ms)\n▶ ExecutorProfile adapter\n  ✔ accepts unregistered adapter name openai-responses (0.7577ms)\n  ✔ rejects empty adapter as structural (0.3128ms)\n✔ ExecutorProfile adapter (1.2654ms)\n▶ TaskContract semantic rules\n  ✔ accepts non-empty commands and valid globs (4.1395ms)\n  ✔ rejects empty acceptance.commands (0.2124ms)\n  ✔ rejects invalid glob-ish scope patterns (0.3401ms)\n✔ TaskContract semantic rules (5.5721ms)\n▶ ResultEnvelope semantic rules\n  ✔ requires unresolved when status is not completed (1.357ms)\n  ✔ rejects completed with scope_violations (0.3387ms)\n✔ ResultEnvelope semantic rules (2.0254ms)\n▶ WorkItem semantic rules\n  ✔ requires gate when awaiting-gate (1.6092ms)\n  ✔ requires null gate for non-awaiting statuses (0.1892ms)\n  ✔ accepts awaiting-gate with non-null gate (0.1253ms)\n✔ WorkItem semantic rules (2.238ms)\n▶ KnowledgeEntry semantic rules\n  ✔ requires Nygard headings for type=adr (1.0322ms)\n  ✔ accepts adr with all four headings (0.3275ms)\n  ✔ rejects multi-paragraph rule body (0.1922ms)\n✔ KnowledgeEntry semantic rules (1.7098ms)\n▶ validateArtifact short-circuit and unknown_schema\n  ✔ returns unknown_schema for unregistered kind (0.1123ms)\n  ✔ does not run semantic rules after structural failure (1.564ms)\n✔ validateArtifact short-circuit and unknown_schema (1.7963ms)\n▶ rolekit validate e2e\n  ✔ discovers fixtures for all 9 kinds (1.4995ms)\n  ✔ executor-profile/invalid-empty-adapter.yaml → exit 1 (278.3232ms)\n  ✔ executor-profile/invalid-missing-name.yaml → exit 1 (217.6892ms)\n  ✔ executor-profile/valid-openai-responses.yaml → exit 0 (216.2228ms)\n  ✔ executor-report/invalid-bad-status.yaml → exit 1 (214.3765ms)\n  ✔ executor-report/invalid-has-verification.yaml → exit 1 (211.2814ms)\n  ✔ executor-report/valid-blocked.yaml → exit 0 (228.2532ms)\n  ✔ gate-policy/invalid-bad-default.yaml → exit 1 (226.327ms)\n  ✔ gate-policy/invalid-missing-trigger.yaml → exit 1 (210.7933ms)\n  ✔ gate-policy/valid-default.yaml → exit 0 (227.5058ms)\n  ✔ knowledge-entry/invalid-adr-missing-headings.md → exit 1 (238.6622ms)\n  ✔ knowledge-entry/invalid-missing-id.md → exit 1 (231.2822ms)\n  ✔ knowledge-entry/invalid-rule-multipart.md → exit 1 (218.3102ms)\n  ✔ knowledge-entry/valid-adr-typescript.md → exit 0 (235.374ms)\n  ✔ result-envelope/invalid-completed-with-violations.json → exit 1 (211.647ms)\n  ✔ result-envelope/invalid-missing-task-id.json → exit 1 (223.8033ms)\n  ✔ result-envelope/valid-completed.json → exit 0 (233.0362ms)\n  ✔ role-profile/invalid-empty-name.yaml → exit 1 (246.3576ms)\n  ✔ role-profile/invalid-wrong-schema.yaml → exit 1 (235.0222ms)\n  ✔ role-profile/valid-implementer.yaml → exit 0 (229.3187ms)\n  ✔ run-event/invalid-missing-payload-field.json → exit 1 (221.6532ms)\n  ✔ run-event/invalid-unknown-type.json → exit 1 (202.7345ms)\n  ✔ run-event/valid-started.json → exit 0 (221.0906ms)\n  ✔ task-contract/invalid-empty-commands.yaml → exit 1 (246.3156ms)\n  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (238.6943ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (242.8514ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (227.865ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (293.2054ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (236.8541ms)\n  ✔ usage error: missing file → exit 2 (229.1824ms)\n  ✔ usage error: unknown flag → exit 2 (221.6401ms)\n  ✔ usage error: unknown command → exit 2 (229.9516ms)\n  ✔ parse_error for empty file (226.5137ms)\n  ✔ parse_error for UTF-8 BOM file (210.9249ms)\n  ✔ unknown_schema when schema field missing (203.6753ms)\n  ✔ --json stdout is JSON only on success (192.8589ms)\n  ✔ help lists only validate command surface (189.737ms)\n✔ rolekit validate e2e (8173.5882ms)\nℹ tests 62\nℹ suites 12\nℹ pass 62\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 8344.0916\n",
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
      "stdout": "Checked 33 files in 17ms. No fixes applied.\n",
      "stderr": "",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "node --test test/e2e/",
      "exit_code": 0,
      "stdout": "▶ rolekit validate e2e\n  ✔ discovers fixtures for all 9 kinds (1.0725ms)\n  ✔ executor-profile/invalid-empty-adapter.yaml → exit 1 (247.5324ms)\n  ✔ executor-profile/invalid-missing-name.yaml → exit 1 (227.0988ms)\n  ✔ executor-profile/valid-openai-responses.yaml → exit 0 (220.1623ms)\n  ✔ executor-report/invalid-bad-status.yaml → exit 1 (202.8934ms)\n  ✔ executor-report/invalid-has-verification.yaml → exit 1 (202.1571ms)\n  ✔ executor-report/valid-blocked.yaml → exit 0 (240.6848ms)\n  ✔ gate-policy/invalid-bad-default.yaml → exit 1 (261.7469ms)\n  ✔ gate-policy/invalid-missing-trigger.yaml → exit 1 (227.0582ms)\n  ✔ gate-policy/valid-default.yaml → exit 0 (248.9593ms)\n  ✔ knowledge-entry/invalid-adr-missing-headings.md → exit 1 (213.0677ms)\n  ✔ knowledge-entry/invalid-missing-id.md → exit 1 (227.6993ms)\n  ✔ knowledge-entry/invalid-rule-multipart.md → exit 1 (234.4999ms)\n  ✔ knowledge-entry/valid-adr-typescript.md → exit 0 (223.9797ms)\n  ✔ result-envelope/invalid-completed-with-violations.json → exit 1 (249.2605ms)\n  ✔ result-envelope/invalid-missing-task-id.json → exit 1 (218.516ms)\n  ✔ result-envelope/valid-completed.json → exit 0 (232.5515ms)\n  ✔ role-profile/invalid-empty-name.yaml → exit 1 (218.8615ms)\n  ✔ role-profile/invalid-wrong-schema.yaml → exit 1 (225.8814ms)\n  ✔ role-profile/valid-implementer.yaml → exit 0 (203.6581ms)\n  ✔ run-event/invalid-missing-payload-field.json → exit 1 (209.684ms)\n  ✔ run-event/invalid-unknown-type.json → exit 1 (199.7661ms)\n  ✔ run-event/valid-started.json → exit 0 (201.6093ms)\n  ✔ task-contract/invalid-empty-commands.yaml → exit 1 (198.228ms)\n  ✔ task-contract/invalid-wrong-kind.yaml → exit 1 (202.5288ms)\n  ✔ task-contract/valid-implement-auth.yaml → exit 0 (266.054ms)\n  ✔ work-item/invalid-awaiting-gate-null.yaml → exit 1 (305.1016ms)\n  ✔ work-item/invalid-bad-kind.yaml → exit 1 (230.5556ms)\n  ✔ work-item/valid-feature.yaml → exit 0 (218.088ms)\n  ✔ usage error: missing file → exit 2 (225.2414ms)\n  ✔ usage error: unknown flag → exit 2 (211.6344ms)\n  ✔ usage error: unknown command → exit 2 (263.7621ms)\n  ✔ parse_error for empty file (284.0093ms)\n  ✔ parse_error for UTF-8 BOM file (283.9124ms)\n  ✔ unknown_schema when schema field missing (329.0471ms)\n  ✔ --json stdout is JSON only on success (315.9859ms)\n  ✔ help lists only validate command surface (303.0988ms)\n✔ rolekit validate e2e (8578.0163ms)\nℹ tests 37\nℹ suites 1\nℹ pass 37\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 8723.1002\n",
      "stderr": "",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block"
    }
  ],
  "providers": {},
  "feature": "2026-07-24-contract-schemas",
  "inputs": {
    "checklist": ".codestable/features/2026-07-24-contract-schemas/contract-schemas-checklist.yaml"
  },
  "input_digests": {
    "checklist": "8c2cda640f0ae9ba5910e408703ca3d69812c73bc25b53383baab2bdf0006621"
  }
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 11842
Checklist bytes: 3968

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
        ".codestable/features/2026-07-24-contract-schemas/contract-schemas-checklist.yaml",
        ".codestable/features/2026-07-24-contract-schemas/contract-schemas-design-review.md",
        ".codestable/features/2026-07-24-contract-schemas/contract-schemas-design.md",
        ".codestable/features/2026-07-24-contract-schemas/contract-schemas-field-matrix.md",
        ".github/workflows/ci.yml",
        ".gitignore",
        "biome.json",
        "fixtures/executor-profile/invalid-empty-adapter.yaml",
        "fixtures/executor-profile/invalid-missing-name.yaml",
        "fixtures/executor-profile/valid-openai-responses.yaml",
        "fixtures/executor-report/invalid-bad-status.yaml",
        "fixtures/executor-report/invalid-has-verification.yaml",
        "fixtures/executor-report/valid-blocked.yaml",
        "fixtures/gate-policy/invalid-bad-default.yaml",
        "fixtures/gate-policy/invalid-missing-trigger.yaml",
        "fixtures/gate-policy/valid-default.yaml",
        "fixtures/knowledge-entry/invalid-adr-missing-headings.md",
        "fixtures/knowledge-entry/invalid-missing-id.md",
        "fixtures/knowledge-entry/invalid-rule-multipart.md",
        "fixtures/knowledge-entry/valid-adr-typescript.md",
        "fixtures/result-envelope/invalid-completed-with-violations.json",
        "fixtures/result-envelope/invalid-missing-task-id.json",
        "fixtures/result-envelope/valid-completed.json",
        "fixtures/role-profile/invalid-empty-name.yaml",
        "fixtures/role-profile/invalid-wrong-schema.yaml",
        "fixtures/role-profile/valid-implementer.yaml",
        "fixtures/run-event/invalid-missing-payload-field.json",
        "fixtures/run-event/invalid-unknown-type.json",
        "fixtures/run-event/valid-started.json",
        "fixtures/task-contract/invalid-empty-commands.yaml",
        "fixtures/task-contract/invalid-wrong-kind.yaml",
        "fixtures/task-contract/valid-implement-auth.yaml",
        "fixtures/work-item/invalid-awaiting-gate-null.yaml",
        "fixtures/work-item/invalid-bad-kind.yaml",
        "fixtures/work-item/valid-feature.yaml",
        "package-lock.json",
        "package.json",
        "packages/cli/bin/rolekit.js",
        "packages/cli/package.json",
        "packages/cli/src/cli.ts",
        "packages/cli/src/parse-input.ts",
        "packages/cli/test/parse-input.test.ts",
        "packages/core/package.json",
        "packages/core/src/compile-task.ts",
        "packages/core/src/errors.ts",
        "packages/core/src/index.ts",
        "packages/core/src/schema-registry.ts",
        "packages/core/src/schemas/executor-profile.ts",
        "packages/core/src/schemas/executor-report.ts",
        "packages/core/src/schemas/gate-policy.ts",
        "packages/core/src/schemas/index.ts",
        "packages/core/src/schemas/knowledge-entry.ts",
        "packages/core/src/schemas/result-envelope.ts",
        "packages/core/src/schemas/role-profile.ts",
        "packages/core/src/schemas/run-event.ts",
        "packages/core/src/schemas/shared.ts",
        "packages/core/src/schemas/task-contract.ts",
        "packages/core/src/schemas/work-item.ts",
        "packages/core/src/types.ts",
        "packages/core/src/validate.ts",
        "packages/core/test/compile-task.test.ts",
        "packages/core/test/schemas.test.ts",
        "packages/core/test/semantics.test.ts",
        "schemas/json/executor-profile.json",
        "schemas/json/executor-report.json",
        "schemas/json/gate-policy.json",
        "schemas/json/knowledge-entry.json",
        "schemas/json/result-envelope.json",
        "schemas/json/role-profile.json",
        "schemas/json/run-event.json",
        "schemas/json/task-contract.json",
        "schemas/json/work-item.json",
        "scripts/export-schemas.ts",
        "scripts/run-tests.ts",
        "test/e2e/package.json",
        "test/e2e/validate-cli.test.ts",
        "tsconfig.json"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-24-contract-schemas/contract-schemas-dod-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-24-contract-schemas",
        "packages/",
        "fixtures/",
        "schemas/",
        "scripts/",
        "test/",
        ".github/",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "biome.json",
        ".gitignore"
      ]
    }
  ],
  "providers": {},
  "feature": "2026-07-24-contract-schemas",
  "inputs": {
    "feature_dir": ".codestable/features/2026-07-24-contract-schemas"
  },
  "input_digests": {},
  "kind": "executable"
}
```
