---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-contract-schemas
roadmap_item: contract-schemas
status: pending
---

# contract-schemas Goal 执行规格

## 1. Identity And Inputs

- 顺序：1/11
- 依赖：none
- 性质：`mixed`
- Design：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-design.md`
- Checklist：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-review.md`
- QA：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-qa.md`
- Acceptance：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-contract-schemas/contract-schemas-dod-results.json`

## 2. Delivery And Core Path

- 交付：建立 npm workspaces/erasable TS/Biome/node:test 基线，交付 9 类 TypeBox schema、语义规则、JSON Schema 导出、`compileTask` 与薄 `rolekit validate`。
- 核心路径：真实 CLI 遍历每类至少 1 正例 + 2 负例，校验 exit 0/1/2、JSON 输出、结构/语义/parse/unknown_schema 分层；导出重跑零 diff。
- 不得提前创建 runner/migrate/adapters/profiles/evals，也不得更改 approved contract。

## 3. Mandatory Commands

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`

必须使用真实依赖和 CLI 进程；缺 package runner 只能按 checklist 建立，不得同名 shim 或 always-green script。

## 4. Feature DoD And Gates

- 进入前由 workflow hook 确认 implementation-ready；design approved、独立 design-review passed。
- Implementation：steps done，scope-gate/dod-runner/evidence-pack passed。
- Review：Grok 4.5 High 独立 Task agent 同时审 spec compliance/code quality，无 blocking。
- QA：覆盖 fixture、CLI、导出幂等、DoD 与 review focus；Acceptance 才更新 checks/items。
- Acceptance 后复核 `goal-commits`，完成 scoped commit 与 clean 检查。

## 5. Evidence, Deliverables And Cleanliness

- 必需证据：command outputs、fixture inventory、CLI JSON/exit matrix、schema export zero-diff、diff summary。
- 交付物：`packages/core`、`packages/cli` 的本条范围、`schemas/json`、fixtures/tests、CI 命令基线及 roadmap patch。
- 禁止 debug 输出、无来源 TODO/FIXME/XXX、注释代码、unused import、同名 shim、临时包或 scope 外模块。

## 6. Failure Recovery Boundary

Implementation gate 失败在 approved scope 内修复；review/QA 失败按 goal feature loop 回 implementation 并重跑。TypeBox 无法表达冻结契约、需要改 roadmap/design、核心 runner 不可得或同项三轮失败时 handoff，禁止弱化 schema/fixture。
