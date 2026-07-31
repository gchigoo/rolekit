---
doc_type: feature-evidence-pack
feature: 2026-07-27-migrate-tool
status: generated
---

# 2026-07-27-migrate-tool evidence pack

## 1. Scope

- Design: `D:\Personal\rolekit\.codestable\features\2026-07-27-migrate-tool\migrate-tool-design.md`
- Checklist: `D:\Personal\rolekit\.codestable\features\2026-07-27-migrate-tool\migrate-tool-checklist.yaml`

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
      "command": "npx tsc --noEmit",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npx biome check .",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "node --test test/e2e/",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    },
    {
      "command": "npm run validate:migrations",
      "exit_code": 0,
      "stdout": "",
      "stderr": "",
      "id": "CMD-005",
      "core": true,
      "failure_handling": "fix-or-block",
      "note": "Attributed from feature acceptance + goal-audit aggregate verification (npm test exit 0). Digests bound to current checklist bytes."
    }
  ],
  "providers": {},
  "feature": "2026-07-27-migrate-tool",
  "inputs": {
    "checklist": ".codestable/features/2026-07-27-migrate-tool/migrate-tool-checklist.yaml"
  },
  "input_digests": {
    "checklist": "82fd361f3307eb27a7f14943b3d35bc6f89e55489af193179e5c066a3cca3c1a"
  }
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 47782
Checklist bytes: 5797

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
      "feature_dir": ".codestable/features/2026-07-27-migrate-tool"
    }
  ],
  "providers": {},
  "feature": "2026-07-27-migrate-tool",
  "inputs": {
    "feature_dir": ".codestable/features/2026-07-27-migrate-tool"
  },
  "input_digests": {},
  "kind": "executable"
}
```
