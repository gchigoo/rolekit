---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-verifier-gate-engine
roadmap_item: verifier-gate-engine
status: pending
---

# verifier-gate-engine Goal 执行规格

## 1. Identity And Inputs

- 顺序：5/11
- 依赖：`pi-rpc-vertical-slice`（必须 `done`）
- 性质：`mixed`
- Design：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-design.md`
- Checklist：同目录 `verifier-gate-engine-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-review.md`
- QA：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-qa.md`
- Acceptance：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-dod-results.json`

## 2. Delivery And Core Path

- 交付：RoleKit 原生 PolicyEngine/verifier/gate，冻结 ignore/observe/confirm/block、revision/change-manifest、GateRecord、resolution/reconcile 与 CLI；只吸收参考判据，不依赖/fork veritack。
- 核心路径：合规真实 run 全程 0 人工 confirm 且 events 有 observe；注入越界 run 在 integration 前 block；await/resume/crash/revision 证据无重复判定或旁路。
- PolicyEngine 是单一事实源，CLI/gate wrapper 不得复制判定公式。

## 3. Mandatory Commands

- `npm test`
- `node --test test/e2e/`
- `npx tsc --noEmit && npx biome check .`
- `rolekit validate <artifact>`

## 4. Feature DoD And Gates

- 依赖 done；steps、scope/dod/evidence gates passed。
- Grok 4.5 High 独立 review 核验判定单一来源、revision/immutable manifest 与终态；QA 跑 policy truth table、live run、crash/reconcile。
- Acceptance 核验 command output、run state/artifacts、GateRecords、snapshots、crash recovery、diff 与 D9 roadmap patch。
- 两授权有效后才 acceptance/scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 必需证据完整采用 checklist：gate records、events/run state、manifest/snapshot、live allow/block、crash recovery、command output 与 diff。
- 交付物限 core policy、runner verifier/gates、CLI thin wrappers、tests/fixtures 与 roadmap patch。
- 禁止 veritack package/runtime dependency、第二套 policy evaluator、可变 HEAD 推断、未解释人工 gate 或临时 gate bypass。

## 6. Failure Recovery Boundary

判定契约需变化、revision 无法闭合、核心 live gate 证据不可得或 scope 可被旁路时 handoff；普通实现/review/QA defect 按 feature loop 修复重验，同项三轮失败即 handoff。
