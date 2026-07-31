---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-27-migrate-tool
roadmap_item: migrate-tool
status: pending
---

# migrate-tool Goal 执行规格

## 1. Identity And Inputs

- 顺序：10/11
- 依赖：`workitem-lifecycle-core`、`knowledge-layer`（均必须 `done`）
- 性质：`functional`
- Design：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-design.md`
- Checklist：同目录 `migrate-tool-checklist.yaml`
- Design review：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-design-review.md`
- Implementation review：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-review.md`
- QA：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-qa.md`
- Acceptance：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-gate-results.json`
- DoD results：`.codestable/features/2026-07-27-migrate-tool/migrate-tool-dod-results.json`

## 2. Delivery And Core Path

- 交付：`rolekit migrate plan|apply --from codestable|superpowers`，fresh-target staging+atomic publish、source manifest、canonical mapping、logical key/ID/fingerprint、KN metadata、receipt 与 crash recovery。
- 核心路径：本仓库 CodeStable 和 Superpowers 5.1.3 样本分别 plan/apply；每个 semantic entity 恰一 migrate/merge 或封闭 skip/error，roadmap-item locator 与最终 target_id 可追踪，产物全 validate，源 bytes 零写。
- RFC8785 raw/canonical、unknown status exit 1、existing different target/unsafe link、Windows crash 与 rollback 均 fail-closed；不得复制宿主编排。

## 3. Mandatory Commands

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`
- `npm run validate:migrations`

## 4. Feature DoD And Gates

- 两依赖严格 done；steps/scope/dod/evidence gates passed。
- Grok 4.5 High 独立 review 核验枚举完整性、mapping/ID、fresh publish、source zero-write 与 license；QA 跑两 source、negative/crash/Windows/fidelity matrix。
- Acceptance 核验 migration reports、source/target manifests、mapping、semantic diff、receipt、zero-target/source diff、Superpowers matrix/license 与 D14 roadmap patch。
- 两授权有效后才 acceptance/scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 必需证据完整采用 checklist：command output、reports、manifests、mapping、semantic diff、receipt、zero diff、Windows crash、Superpowers/license、roadmap patch。
- 交付物限 migrate package/CLI、fixtures/checkers、attribution、reports/tests 与批准的全量 D14 patch。
- 禁止修改源、复用 credential remote、symlink/junction escape、已有不同 target 合并、全 skip、猜未知状态、非 canonical bytes 或残留 staging/backup。

## 6. Failure Recovery Boundary

source manifest 不完整、mapping 非单值、semantic fidelity/zero-write/atomic publish 无法证明、license 不明或契约需变化时 handoff；普通缺陷按 feature loop 修复，三轮失败即 handoff。
