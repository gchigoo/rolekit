---
doc_type: feature-acceptance
feature: 2026-07-24-knowledge-layer
status: passed
accepted: 2026-07-29
authorization_ref: approval-report.md#goal-acceptance
---

# knowledge-layer 验收

## 授权

`acceptance_authorization: approved`（`rk-v2-goal-exec-20260728-a1` / approval-report.md#goal-acceptance）

## 交付核对

| 项 | 证据 |
|---|---|
| core KnowledgeCatalog + compilePrompt 可选 PromptRule | `packages/core/src/knowledge/` + compile-prompt |
| CLI FileKnowledgeStore + create/get/search/edit/set-status | `packages/cli/src/knowledge/` + e2e |
| runner knowledge snapshot / digest / reservation-only | knowledge-loader + run-manager + unit |
| 四类 fixtures 正负 validate | `fixtures/knowledge-entry/` |
| D8 roadmap/contract/pi-rpc/workitem/command-map patch | roadmap + design patches |
| code review | review.md round 2 **passed** |
| QA | qa.md **passed** |

## DoD

- DOD-DESIGN-001 / DOD-IMPL-001 / DOD-REVIEW-001 / DOD-QA-001 / DOD-ACCEPT-001：满足
- 明确不做未越界（无 WorkItem FK、无 migrate 映射、无 adr/learning/note 注入、core knowledge 无 I/O）

## Verdict

**accepted** — 进入 scoped commit；goal `current_feature_index` → 9（migrate-tool）
