---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-role-profiles-migration
roadmap_item: role-profiles-migration
status: pending
---

# role-profiles-migration Goal 执行规格

## 1. Identity And Inputs

- 顺序：4/11
- 依赖：`pi-rpc-vertical-slice`（必须 `done`）
- 性质：`mixed`
- Design：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-design.md`
- Checklist：同目录 `role-profiles-migration-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-review.md`
- QA：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-qa.md`
- Acceptance：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-role-profiles-migration/role-profiles-migration-dod-results.json`

## 2. Delivery And Core Path

- 交付：按 frozen 非 1:1 mapping 生成 7 份 RoleProfile YAML 与 prompt fragments（6 转换 + 原生 researcher），全部 schema valid 且可编译 prompt。
- 核心路径：implementer、reviewer、researcher 各以对应 profile 完成至少一次真实 RoleKit run，artifact 经 schema/semantic 校验。
- 源 `pi-delivery-rolekit` 只读；不得原地改写、复制旧 orchestration 或虚构第七个转换来源。

## 3. Mandatory Commands

- `npm run validate:profiles`
- `npm test`
- `npx tsc --noEmit && npx biome check .`
- `rolekit validate <run-artifact>`

`<run-artifact>` 必须覆盖三角色真实链路证据。

## 4. Feature DoD And Gates

- 依赖 done；steps/scope/dod/evidence gates passed。
- Grok 4.5 High 独立 review 核验 mapping、prompt 边界与无宿主逻辑；QA 运行 7 profile compile 和三角色 live run。
- Acceptance 核验 command output、profiles/prompts、run artifacts 与 diff summary。
- 两授权有效后才 acceptance/scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 交付物：7 profiles、prompt fragments、mapping/validation tests、3 角色 run artifacts、roadmap patch。
- 禁止复制 credential、旧 session、宿主状态机、临时 profile 或 scope 外角色；generated prompt 中不得含 secret。

## 6. Failure Recovery Boundary

映射或 profile 契约需变化则 handoff 回 design；单个 live run 可按同 TaskContract 新 attempt 重试但不得用 mock 替代；三角色证据不可得、reviewer 不可用或同项三轮失败时 handoff。
