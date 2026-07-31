---
doc_type: feature-review
feature: 2026-07-27-migrate-tool
status: passed
review_state: passed
round: 3
reviewer: subagent
reviewer_id: independent-task
reviewed: 2026-07-29
review_reason: "REV-001/003 关闭；REV-002 降为 important 覆盖深度 residual；blocking=0"
---

# migrate-tool 代码审查报告

## 结论

**PASS**（blocking=0；round 3）

review-fix 后：D10 投影断言已非 stub，`buildSemanticDiff` 对 assertion-hash-mismatch fail-closed；D2a / duplicate 护栏仍成立。REV-002 剩余为 Matrix 负例覆盖深度，非整条验收路径缺失，降为 important residual-risk。可进入 Goal QA（仍须另轨补 checklist/evidence）。

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-27-migrate-tool/migrate-tool-design.md`（`status: approved`）
- Checklist: `.codestable/features/2026-07-27-migrate-tool/migrate-tool-checklist.yaml`（steps/checks 仍全 `pending`）
- Evidence pack / gate / DoD results: none
- Diff basis: round 2 后增量——`buildEntityAssertions` / Superpowers `buildMappingEntry` 真实投影、`promote.buildSemanticDiff` 重建+抛错、duplicate/D2a 既有修复、测试扩至 15
- Review mode: full-rereview（round 3，material review-fix 后独立复审）
- Prior review: round 2 FAIL，blocking REV-001/002；REV-003 已关闭
- Baseline dirty: 仓库根 `.rolekit/`（非 migrate 验收产物）；与本 feature 无关

### Independent Review

- Detection: 本轮为 parent 委派的 independent-task lane（round 3）；OCR 未执行
- 环节 A: independent-agent / completed
- 环节 B: skipped（本 subagent 未跑 OCR）
- Gate effect: `reviewer: subagent`；以 design D* 与仓库事实合并结论

## 2. Diff Summary

- 相对 round 2 关键增量：`codestable/map.ts` `buildEntityAssertions` 对 WI/KN 写非空 `expected_sha256/actual_sha256`；`promote.ts` `buildSemanticDiff` 同构重建并在 `detail_sha256` 不等时抛 `migration_semantic_fidelity_failed`（refs 含 `assertion-hash-mismatch`）；Superpowers migrate 传入 profile/note 投影；`critical-contracts` 补 D5 全表、duplicate-skip ref、assignIds>999；e2e 含 CS/SP audit+apply
- 风险热点：负例覆盖仍浅；promote 未对 disk 物化内容做独立 expected≠actual 比对；checklist/evidence 未齐

## 3. Adversarial Pass

- 假设：assertions 仍 stub（expected/actual 恒 null）或 hash 链可静默漂移
- 攻击结果：本仓 CS audit 抽检 `entries=33`、`emptyAssert=0`、`chainOk=33`、`chainBad=0`、`nullEA=0`、`nonNullProj=33`；样例 ADR 投影 hash 非空且 expected=actual；promote 路径对 mismatch 抛错；SP/CS apply e2e 全绿 → REV-001 关闭
- D2a：source-after 仍在 `writeMigrationBundle` 之前；`migration_source_changed` / 外层 IO 无 staging report；仅 rename 失败附 staging 指针 → REV-003 保持关闭
- 负例：仍缺 multibind/decisions/DAG/crash/tamper 等，但 Goal Matrix 两条主验收路径（CS 自迁、SP 样例）已有 e2e → REV-002 降级

## 4. Findings

### Prior blocking disposition

- [x] REV-001 **已关闭** `packages/migrate/src/adapters/codestable/map.ts` / `superpowers/map.ts` / `promote.ts` / `api.ts`
  - Evidence:
    - `buildEntityAssertions` migrate/merge：WI=`{kind,title,status,depends_on}`、KN=`{type,title,status,tags,created,source,body_sha256}` → 非空 expected/actual
    - Superpowers `buildMappingEntry` 传入 profile/note 投影（非 null stub）
    - `buildSemanticDiff` 同构重建 detail；`sha256Canonical(detail) !== a.detail_sha256` → `migration_semantic_fidelity_failed` + `assertion-hash-mismatch`
    - 现场 audit：`nullEA=0`、`nonNullProj=33`、`chainOk=33`
  - 残余（非 blocking）：expected 与 actual 同源于 plan 投影（非 disk 独立实测）；属保真深度，记入 residual / REV-002 侧

- [x] REV-002 **降级为 important residual-risk**（不再 blocking）
  - Evidence: migrate 相关测例 15 pass；含 D5 状态表、duplicate-skip ref、assignIds>999、CS audit、CS/SP apply e2e、SP gate
  - 仍缺：multibind、decisions 零/多 match、被引用 empty/owner skip、DAG/cycle/goal、source-change/symlink/超限、rename 零 target、no-op 篡改、禁词、落盘双链负例等
  - 判断：缺口是覆盖深度，不是 Goal Matrix 主验收路径整段缺失；不阻塞进入 QA，但 QA 须加压负例

- [x] REV-003 **保持关闭** `packages/migrate/src/promote.ts`
  - Evidence: source-after 在 bundle 写之前；早期失败无 staging pointer；仅 rename 失败附 staging report

### blocking

none

### important

- [ ] REV-002（降级续）`packages/migrate/test/` / `test/e2e/migrate.test.ts`
  - 负例/golden 深度不足；QA 应用坏语义/边界必红用例加压
  - Impact: 高风险边界仍主要靠人工/后续补测证明

- [ ] REV-004 `migrate-tool-checklist.yaml`
  - steps/checks 仍全 `pending`；无 evidence-pack/gate/DoD
  - Impact: Goal lane DOD-IMPL-001 未满足；进 QA 前须另轨补齐

- [ ] REV-005 `packages/migrate/test/unit/codestable-scan.test.ts`
  - 标题仍写冻结 `11/0/0/0/1/11/6/0/1`，断言 `compound: 3`
  - Impact: design D4 与测试/源现状口径不一致

- [ ] REV-006 `packages/migrate/src/promote.ts` `validateTree`
  - 仍偏 WorkItem + goal/cycle；Knowledge/RoleProfile/fragment 未做 D9 全量闭合
  - Impact: fragment 错链可能漏到 rename 后

- [ ] REV-007 `packages/migrate/src/status.ts` `resolveAggregateStage`
  - 仍允许 `sourceKey.endsWith(entityField)`，偏离 D5「entity 字段等于 source_key」
  - Impact: 阶段解析可能误收异名产物

- [ ] REV-008 `packages/migrate/src/adapters/codestable/map.ts` field_map
  - migrate/merge 仍仅 `{target_field:'source', source_refs:[source_key]}`，弱于 D10 path+locator 口径
  - Impact: mapping 可审计性弱于冻结契约

### nit

- [ ] REV-009 `packages/migrate/src/api.ts`：`adapter.detect` 可复用一次结果
- [ ] REV-010 biome：migrate 包仍可能有 unused import / non-null assertion 等告警（未作 blocking）
- [ ] REV-013 `packages/migrate/test/unit/critical-contracts.test.ts`：hash 形状用例仍用 `expected/actual=null` 样例，与产品非 stub 现状脱节（建议改为真实投影 golden）

### suggestion

- [ ] REV-011 抽纯函数 semantic assertion builder，golden 锁真实投影 RFC8785（含 expected≠actual 负例：改 plan 或改 disk 必红）
- [ ] REV-014 `buildAuditSemanticDiff` 可与 promote 共用同构校验（audit 路径目前重建但不抛 mismatch）

### learning

- 投影链闭环（assertion detail ↔ semantic-diff detail）与「plan 投影 vs disk 物化」是两层保真；前者已落地，后者仍是 QA 加压点

### praise

- REV-001 修复可核验：33 条 projection 全非空且链完整
- promote 对 assertion-hash-mismatch fail-closed，消除 round 2 的静默改 `code` 风险（原 REV-012 关闭）
- 15 测例覆盖 D5 表、duplicate-skip、ID 上限与两条主 e2e apply

### closed this round (non-blocking priors)

- [x] REV-012（原 important）静默改 `code` 回 `ok` —— 已被 throw 取代

## 5. Test And QA Focus

- QA 必跑：CS/SP fresh apply + `validate:migrations`；重跑 no-op；审计 bundle mapping↔semantic 重算
- QA 加压：multibind、decisions、skip-invalid、DAG/cycle、source-after、symlink/超限、rename 故障零 `.rolekit`、no-op 篡改拒绝、禁词丢弃
- 建议补测：真实投影 golden；故意改 assertion/detail 负例；disk 与 plan 投影分叉负例

## 6. Residual Risk

- REV-002 负例深度；acceptance 不得只信 happy path
- 仓库根未跟踪 `.rolekit/`；验收只用 temp fresh target
- compound discovered=3 与 design 冻结句不一致（REV-005）
- Knowledge/Profile validate 缺口（REV-006）
- checklist/evidence 未齐（REV-004）——进 QA 前由 Goal 轨补

## 7. Verdict

- Status: **passed**
- Round: **3**
- Blocking count: **0**
- Resolved since round 2: **REV-001**；**REV-003** 保持关闭；**REV-002** 降 important；**REV-012** 关闭
- Next: Goal lane QA（先补 checklist/evidence 若 DOD 要求）；important 可延后但须进 residual

## 8. Focused Closure

none（本轮为 material full-rereview，非 test/docs-only focused closure）

## 9. Verification Evidence Observed

| 命令/观察 | 结果 |
|---|---|
| `node --test packages/migrate/test/unit/*.test.ts test/e2e/migrate.test.ts` | 15 pass / 0 fail |
| CS audit 现场抽检 mapping↔semantic | emptyAssert=0；chainOk=33；nullEA=0；nonNullProj=33 |
| `buildEntityAssertions` / Superpowers 投影 | WI/KN/profile/note 非空 expected/actual |
| `buildSemanticDiff` mismatch | 抛 `migration_semantic_fidelity_failed` + `assertion-hash-mismatch` |
| promote D2a 顺序 | source-after 在 `writeMigrationBundle` 前；早期失败无 staging report |
| `findReferencedSkipViolations` + step5 | 排除 duplicate；duplicate 从 workItems/knowledge 物化数组移除 |
| checklist | 全部 `pending` |
