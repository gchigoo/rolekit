---
doc_type: feature-design-review
feature: 2026-07-24-workitem-lifecycle-core
status: passed
review_state: passed
review_reason: ""
reviewer_id: "18aa1afa-cd7f-4be7-8cab-c1123a6317e1"
reviewed: 2026-07-24
round: 7
---

# workitem-lifecycle-core feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-design.md`
- Checklist: `.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-checklist.yaml`
- 对照：最新 pi-rpc / verifier / contract designs、rolekit-v2 roadmap/items、ADR 002/003
- 代码事实：greenfield；本审查只判 design 可实现性，不把缺源码作为 finding

### Independent Review

- Reviewer: Grok 4.5 High（owner 指定）
- Session: `18aa1afa-cd7f-4be7-8cab-c1123a6317e1`
- 模式：独立只读；禁止读取本报告；reviewer 前后项目 checksum 一致
- 历史：多轮完整复审闭合 PolicyEngine 包边界、双层 gate、D13、prepare/link/start saga、deferred blocked adopt、retry/CAS/create 并发与 mirror 恢复；round 7 最终 PASS

## 2. Design Summary

- core 提供 `transition` / `attachRun` / `adoptRunResult` / `selectLane`，CLI 负责锁与命令编排。
- existing run 按 phase 无 loader 恢复；new run 固定 `policy → D5/lane → 条件 loadRunInput → prepare/link/mirror/start/wait/adopt`。
- retry 不伪造 `executing→executing` self-loop；修订 task.id、retry reservation replay 与上游一致。
- `linkedRevision + latestRunId` CAS 防 start/done 竞态回退；run reject/block 由再次 start deferred-adopt 为 WI blocked。
- create 在全局 WorkItem 锁内扫描、分配、校验、写入，防并发撞号。

## 3. Findings Closure

- [x] existing-run `prepared|starting` 先 `ensureAuditEvent` 再 `startPrepared`；其余 phase 分支封闭。
- [x] D5 confirm/block、direct 不被 task/profile loaders 误阻断；delegated loader 失败 WI/run 零变化。
- [x] override mirror 在 link 后、start 前写；crash 后按 WI id + override ts 去重补写。
- [x] adopt CAS 真值表覆盖首次采纳、同 run 后继态 no-op、闭包外 `workitem_changed`。
- [x] retry flag、task_id 绑定、attachRun 无 self-loop与 pi-rpc reservation 契约对齐。
- [x] create id 分配锁序与双进程唯一性验收已冻结。

## 4. Evidence Confidence Ledger

| Check | Verdict | Basis |
|---|---|---|
| 命令/状态机闭环 | pass | D2/D2a、transition/attach/adopt 场景矩阵 |
| Saga 与 crash recovery | pass | D2(d)(e)、S6、Matrix |
| D13 五态消费 | pass | pi-rpc D13 单一事实源 + deferred blocked adopt |
| Gate / JSON / exit 码 | pass | D2b/D3/D5 与 verifier router 分 shape 对齐 |
| ADR 002/003 边界 | pass | 实现门禁、direct 弱保护、只实现 WI 白名单 (3)(4) |
| Checklist | pass | YAML 校验通过，steps/checks/DoD 可追踪 |

## 5. Residual Risk

- coordinated v1 执行面仍等价 delegated。
- question、blocked 解阻、direct class-(1) 保护及更多状态恢复命令后置 hardening。
- implementation 仍严格等待 contract-schemas / pi-rpc / verifier done，且联合 roadmap patch 全量合入。

## 6. Verdict

- **Status: passed**
- Design admission 已通过；不等于 implementation admission。
- Next: 交回 cs-epic，继续剩余 child design；全部通过后统一进入 owner checkpoint。
