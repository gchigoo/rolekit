---
doc_type: feature-qa
feature: 2026-07-24-workitem-lifecycle-core
status: passed
reviewed: 2026-07-29
---

# workitem-lifecycle-core QA

## 范围

对照 design 验收契约与 checklist DoD：状态机/selectLane 单测、store 锁、CLI 六子命令、WI-/run- gate、delegated mock 双 gate 链、D5 observe/block。

## 命令证据

| ID | 命令 | 结果 |
|---|---|---|
| CMD-001 | `node --test packages/core/test/workitem-state-machine.test.ts packages/cli/test/workitem-store.test.ts` | pass |
| CMD-002 | `node --test test/e2e/workitem-cli.test.ts` | 5/5 pass（含 delegated mock 双 gate、D5 observe/block、前缀隔离） |
| CMD-003 | `npx tsc --noEmit` | pass |
| CMD-004 | `rolekit validate` work-item yaml | pass（临时样例后已清理） |
| 回归 | `test/e2e/gate-cli.test.ts` run- 路径 | pass（WI missing → workitem_not_found） |

## 场景覆盖

- create→next→design→start direct→done（final ignore）
- design-artifact confirm→WI approve→delegated mock start→verifying→done confirm→WI approve→done
- D5 observe 落盘 auto-pass；D5 block exit 1 `workitem_blocked`
- 非法转移 / dependency_not_found / 未知 gate 前缀 exit 2
- 8×8 矩阵、goal 不变量、D13 adopt、selectLane D7、store stale/CAS

## 残余

- runner 既有 flaky（gate-pipeline / concurrent-change）与本条无关（packages/runner 无 diff）
- crash 故障注入矩阵以 saga 代码路径 + ensureAuditEvent 单测为主，未扩全量 chaos e2e
- Pi 真机委派非本条 blocker（mock 闭环已覆盖命令面）

## Verdict

**passed**
