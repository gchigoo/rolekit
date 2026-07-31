---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-workitem-lifecycle-core
roadmap_item: workitem-lifecycle-core
status: accepted
---

# workitem-lifecycle-core Goal 执行规格

## 1. Identity And Inputs

- 顺序：8/11
- 依赖：`pi-rpc-vertical-slice`、`verifier-gate-engine`（均必须 `done`）
- 性质：`functional`
- Design：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-design.md`
- Checklist：同目录 `workitem-lifecycle-core-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-review.md`
- QA：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-qa.md`
- Acceptance：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-workitem-lifecycle-core/workitem-lifecycle-core-dod-results.json`

## 2. Delivery And Core Path

- 交付：WorkItem v1、状态机/lane、store/CAS、create/next/start/resume/drop/done/gate CLI，复用 RunManager 与 PolicyEngine；闭合 question、deferred adopt、retry/recovery-cycle。
- 核心路径：真实 CLI create→next→start（delegated run）→done，非法转移 exit 1；direct/delegated、question confirm、gate resolution、caller crash/retry 均按冻结 saga/CAS 证据运行。
- RunManager 是唯一应用控制面；WorkItem 不直接 spawn executor，CLI 不复制状态机。

## 3. Mandatory Commands

- `npm test`
- `node --test test/e2e/`
- `npx tsc --noEmit && npx biome check .`
- `rolekit validate <artifact>`

## 4. Feature DoD And Gates

- 两依赖严格 done；steps/scope/dod/evidence gates passed。
- Grok 4.5 High 独立 review 重点检查 saga、lock/CAS、idempotency、question/gate/recovery；QA 跑真实 CLI/run 与 crash matrix。
- Acceptance 核验 workitem YAML、runs/events/gate_log、lane decisions、command output、diff 与 roadmap patch。
- 两授权有效后才 acceptance/scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 必需证据完整采用 checklist：command output、run artifacts、WorkItem YAML、events、gate_log、diff summary、roadmap patch。
- 交付物限 core lifecycle/store、CLI、runner/policy seams 的批准扩展、tests/fixtures 与 D8 patch。
- 禁止第二套 run manager/policy engine、self-loop attach、无 CAS adopt、隐藏 retry、临时 lock/workitem 或 scope 外知识层实现。

## 6. Failure Recovery Boundary

依赖未 done 立即 handoff；saga 无法证明零双启/零丢关联、question/gate 契约需变化或核心 live path 不可验证时 handoff。普通 defect 按 feature loop修复重验，三轮失败即 handoff。
