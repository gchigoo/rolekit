---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-host-adapter-skills
roadmap_item: host-adapter-skills
status: pending
---

# host-adapter-skills Goal 执行规格

## 1. Identity And Inputs

- 顺序：3/11
- 依赖：`pi-rpc-vertical-slice`（必须 `done`）
- 性质：`functional`
- Design：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-design.md`
- Checklist：同目录 `host-adapter-skills-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-review.md`
- QA：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-qa.md`
- Acceptance：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-dod-results.json`

## 2. Delivery And Core Path

- 交付：pi/codex/cursor 三份薄 Skill/规则入口，只做意图映射和 CLI 调用，不复制 RoleKit 工作流语义。
- 核心路径：至少两个不同宿主各通过 Skill 驱动同一 RoleKit CLI 完成至少一次 delegated run，并由 session/run artifacts 与 checker 双向证明。
- 任何 adapter 内业务状态机、验证公式或宿主私有 schema 都违反 ADR 001。

## 3. Mandatory Commands

- `npm run lint:adapters`
- `npx biome check .`
- `rolekit validate <artifact>`
- `npm run check:delegation -- <session> <run-dir>`

动态参数必须来自真实两宿主 session/run；人工声称或复制 artifact 不算通过。

## 4. Feature DoD And Gates

- 依赖 done；steps 与 implementation gates passed。
- Grok 4.5 High 独立 review 重点检查薄入口和重复逻辑；QA 实际运行两宿主路径。
- Acceptance 核验 command output、run artifacts、skill diff 与 delegation checker。
- Acceptance/commit 两授权均有效后才写状态并 scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 交付物：三个宿主入口、adapter lint/checker、两宿主真实 session/run 证据与 roadmap patch。
- 禁止把 run orchestration、gate/recovery、secret、临时 session dump 或宿主 credential 纳入 adapter/reports。
- Scope 外宿主配置不得修改；临时安装/日志必须清理。

## 6. Failure Recovery Boundary

某宿主不可用时可换第三个已批准宿主，但必须仍满足两个真实宿主；无法取得两个宿主证据、需在 adapter 复制业务逻辑、独立 reviewer 不可用或同项三轮失败时 handoff。
