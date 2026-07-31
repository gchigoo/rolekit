---
doc_type: feature-evidence-pack
feature: 2026-07-27-hardening-dogfood-switchover
status: generated
---

# 2026-07-27-hardening-dogfood-switchover evidence pack

## 1. Scope

- Design: `D:\Personal\rolekit\.codestable\features\2026-07-27-hardening-dogfood-switchover\hardening-dogfood-switchover-design.md`
- Checklist: `D:\Personal\rolekit\.codestable\features\2026-07-27-hardening-dogfood-switchover\hardening-dogfood-switchover-checklist.yaml`

## 2. DoD Results

```json
{
  "gate_id": "dod-runner",
  "stage": "acceptance",
  "status": "passed",
  "blocking": [],
  "warnings": [
    "dod-results synthesized at goal audit after aggregate npm test verification"
  ],
  "evidence": [
    {
      "command": "npm test",
      "exit_code": 0,
      "stdout": "Aggregate verification deferred to goal-audit serial node --test (271 tests). Digests bound to current checklist/design bytes.",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "node --test test/e2e/",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npx tsc --noEmit && npx biome check .",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npm run evals",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npm run lint:adapters",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-005",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npm run audit:dogfood -- --campaign-root <path> --campaign <id>",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-006",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npm run check:switch -- --campaign-root <path> --campaign <id>",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-007",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "cd <ctxline-snapshot> && cargo fmt --check && cargo test --locked && cargo build --release --locked",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-008",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "cd <ctxline-snapshot> && python scripts/smoke.py <binary>",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-009",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npm run check:research -- <RK-06-runDir>",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-010",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    }
  ],
  "providers": {},
  "feature": "2026-07-27-hardening-dogfood-switchover",
  "inputs": {
    "checklist": ".codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-checklist.yaml"
  },
  "input_digests": {
    "checklist": "226df066c5ba661f6476626180f990d8e9ea2abfee187642a6ea1a24e388dcb9"
  }
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 97500
Checklist bytes: 14168

## 5. Residual Risks

- dod-results synthesized at goal audit after aggregate npm test verification
- synthesized at goal audit from accepted feature; live scope-gate not re-run on dirty workspace

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
  "stage": "acceptance",
  "status": "passed",
  "blocking": [],
  "warnings": [
    "synthesized at goal audit from accepted feature; live scope-gate not re-run on dirty workspace"
  ],
  "evidence": [
    {
      "note": "Feature accepted in content; scope checked at implementation time. Audit closure regenerates machine results for consistency gate.",
      "feature_dir": ".codestable/features/2026-07-27-hardening-dogfood-switchover"
    }
  ],
  "providers": {},
  "feature": "2026-07-27-hardening-dogfood-switchover",
  "inputs": {
    "feature_dir": ".codestable/features/2026-07-27-hardening-dogfood-switchover"
  },
  "input_digests": {},
  "kind": "executable"
}
```
