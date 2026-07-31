---
doc_type: feature-acceptance
feature: 2026-07-24-workitem-lifecycle-core
status: passed
accepted: 2026-07-29
authorization_ref: approval-report.md#goal-acceptance
---

# workitem-lifecycle-core 验收

## 授权

`acceptance_authorization: approved`（`rk-v2-goal-exec-20260728-a1` / approval-report.md#goal-acceptance）

## 交付核对

| 项 | 证据 |
|---|---|
| WorkItem 状态机 + selectLane（core 纯函数） | `packages/core/src/workitem/` + 单测 |
| store 锁/CAS/原子写 | `packages/cli/src/workitem/store.ts` + store 单测 |
| 六子命令 create/list/next/design/start/done | CLI + e2e |
| WI- gate 路由与 run- 隔离 | cli.ts + gate/workitem e2e |
| D4/D5/D13/saga | start.ts + state-machine + e2e |
| roadmap 4.5/4.8/4.9 patch | rolekit-v2-roadmap.md changelog 2026-07-29 |
| host-adapter 跟进 | adapters/{cursor,pi,codex}/SKILL.md |
| compound / 盘点清单 | design §1a + compound/workitem-lifecycle-core.md |
| code review | review.md round 2 **passed** |
| QA | qa.md **passed** |

## DoD

- DOD-DESIGN-001 / DOD-IMPL-001 / DOD-REVIEW-001 / DOD-QA-001 / DOD-ACCEPT-001：满足
- 明确不做未越界（无 knowledge/migrate、无 blocked 恢复 CLI、coordinated≡delegated）

## Verdict

**accepted** — 进入 scoped commit；goal `current_feature_index` → 8（knowledge-layer）
