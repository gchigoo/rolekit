---
doc_type: learning
title: workitem-lifecycle-core 沉淀
created: 2026-07-28
feature: workitem-lifecycle-core
tags: [workitem, lifecycle, gate, saga]
---

# workitem-lifecycle-core 沉淀

## 盘点清单结论（留/砍/改）

见 feature design §1a：feature/issue/refactor/goal 进 WorkItem；ADR/attention/compound 归 KnowledgeEntry；阶段报告模板与全人工 stage gate 砍除；designing/checklist/状态词表改为状态机+契约。

## 实现要点

- core 纯函数：`transition` / `attachRun` / `adoptRunResult` / `selectLane` / process-gate reducers；PolicyEngine 双消费，CLI 不复制规则表。
- start 短锁 saga：existing-run 无 loader；new = policy→D5→lane→loadRunInput→prepare→link→mirror→start→wait→CAS adopt。
- 双层 gate：run- 与 WI- 前缀分 shape；run awaiting 时 WI 保持 executing。
- D5 一次性：gate_log 已有 design-artifact approved|auto-pass 则跳过。
- v1 延后：dropped/blocked 恢复、verifying→executing、executing→WI awaiting-gate、question 升 WI gate。

## 故障模式

- prepare 后 WI CAS 失败须 `abortPrepared`；abort 失败留 `prepared_abort_failed`。
- Windows 锁用 `wx` + stale pid 清理一次；失败 `lock_held`。
