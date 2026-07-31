---
doc_type: feature-review
feature: 2026-07-24-workitem-lifecycle-core
status: passed
review_state: passed
review_reason: ""
reviewer_id: grok-4.5-high-r2
reviewed: 2026-07-29
round: 2
---

# workitem-lifecycle-core code review (round 2 focused closure)

## Scope

对照 round 1 blocking B1–B4，只读核对当前实现是否已闭合；附带扫 N1/N2。未改实现。

审查文件：`packages/cli/src/workitem/start.ts`、`commands.ts`；`packages/core/src/workitem/state-machine.ts`；e2e `test/e2e/workitem-cli.test.ts`（D5 路径）。

## Former blockers

### B1. D5 observe gate_log 在 delegated link 合并 — CLOSED

`start.ts` link 短锁内 `attachRun` 基件显式合并：

```ts
next = attachRun({
  ...cur.item,
  gate_log: deferred.item.gate_log,
  lane: deferred.lane,
  lane_reason: deferred.lane_reason,
  lane_overrides: deferred.item.lane_overrides,
}, handle.run_id, mode)
```

短锁内 observe 写入内存 `item` → `deferred.item` 携带 `gate_log`；link 不再丢弃。e2e `D5 observe persists gate_log` 断言 `auto-pass`。

### B2. adoptAndReturn 消费 linkedRevision — CLOSED

`adoptAndReturn(..., linkedRevision, runId, envelope)` 在 `latest === runId` 之后：

- `cur.revision !== linkedRevision` 时按 D2(e) 真值表：
  - completed → verifying|awaiting-gate|done|blocked → `no_op:true`
  - blocked 且 status=blocked → `no_op:true` + `run_blocked`
  - failed|cancelled|question 且仍 executing → `no_op:true`（不再覆写 `updated`）
  - 其余 → `workitem_changed`
- revision 未变才调用 `adoptRunResult` 并按需 `store.write`

参数已参与分支，不再是死参数。

### B3. D5 block → `workitem_blocked` + exit 1 — CLOSED

短锁 early：`blocked` 返回 `{ exitCode: 1, error: 'workitem_blocked' }`。

`commands.ts` start：

```ts
if (result.exitCode !== 0 || result.error) {
  ...
  process.exitCode = result.exitCode || 1
  return
}
```

不再仅依赖 `result.error`；e2e 断言 `error === 'workitem_blocked'`。

### B4. WI gate approve 注入 deps — CLOSED

`cmdWorkItemGate` approve：`listAll` 解析 `depends_on` → `approveWorkItemGate(item, now, deps)`。

core 签名 `approveWorkItemGate(item, now, deps = [])`，`transition(..., { now, deps })` 可走 goal done 不变量。与 `doneWorkItem` 一致。

## Non-blocking（附带）

### N1. direct 用手写 status — CLOSED

direct 路径：`transition(item, 'executing', { now })`（已 executing 则仅刷新 `updated`），不再手写 `status: 'executing'`。

### N2. mirror 仅历史 run — CLOSED

主路径：`hadHistoricalRuns = deferred.item.runs.length > 0`，`if (latestOverride && hadHistoricalRuns)` 才 `ensureAuditEvent`。首次无历史 run 的 override 不镜像。

（`handleExistingRun` prepared/starting 恢复路径仍按盘上 override 镜像，属恢复语义，非首次 start 问题。）

## Residual

- round 1 N3 测试矩阵（CAS 竞态、crash 重入、双进程 create）仍偏薄；本轮 e2e 已补 D5 observe/block，未要求为 blocker。
- 未重跑全量测试；结论依源码路径 + 既有 e2e 字面。

## Verdict

**passed**

B1–B4 均有代码证据闭合；N1/N2 一并闭合。可进入后续 accept/合入流程。
