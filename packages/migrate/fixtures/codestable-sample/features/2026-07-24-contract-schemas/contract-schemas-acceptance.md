---
doc_type: feature-acceptance
feature: 2026-07-24-contract-schemas
status: passed
accepted: 2026-07-28
authorization_ref: approval-report.md#goal-acceptance
---

# contract-schemas 验收报告

## 1. Scope

- Design：`contract-schemas-design.md`（approved）
- Checklist：steps 全 done；checks 全 passed
- Review：`contract-schemas-review.md`（passed，reviewer=subagent；REV-001 已 closure）
- QA：`contract-schemas-qa.md`（passed）
- Evidence：evidence-pack / scope-gate / dod-runner / evidence-pack-results 均为 passed
- Authorization：`ResumeGoalAcceptance` + `approval-report.md#goal-acceptance`（approved，confirmation_id=rk-v2-goal-exec-20260728-a1）

## 2. Delivery Record

- monorepo 基线：npm workspaces、erasable TS、Biome、node:test、Windows CI
- `@rolekit/core`：9 类 TypeBox schema、两层校验、`validateArtifact`、`compileTask`（deepFreeze）、错误模型
- `@rolekit/cli`：薄壳 `rolekit validate`，exit 0/1/2，`--json`
- `schemas/json/`：9 份导出；`fixtures/`：每类 ≥1 正 + 2 负
- field matrix、CI workflow、items/roadmap/CONTEXT/attention 回写

## 3. Verification Evidence

| 命令 | 结果 |
|---|---|
| `npm test` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx biome check .` | exit 0 |
| `node --test test/e2e/` | exit 0（Node 24 经 `test/e2e/package.json` main 入口） |

真实 CLI 遍历 fixtures：正例 exit 0；结构负例 exit 1 + structural；语义负例 exit 1 + semantic；用法错误 exit 2；BOM/空文件 parse_error；unknown_schema 稳定。

## 4. Checklist Checks

全部 15 项 checks 已标 `passed`（名词契约、编排、挂载点、范围守护、验收场景）。

## 5. Roadmap / Architecture / Requirements Writeback

- `rolekit-v2-items.yaml`：`contract-schemas` → `done`
- `rolekit-v2-roadmap.md`：条目状态 → `done`
- `requirements/CONTEXT.md`：补 ValidationResult / 语义规则 / schemaRegistry；WorkItem.kind 含 goal
- `attention.md`：记录 `@rolekit` scope 与 Biome
- 轻量 ADR：两层校验与不引 Ajv 已由实现验证；建议后续 `cs-domain` 并入 ADR 004 consequences（本阶段不代写）

## 6. Residual Risks

- REV-002：Node 24 目录测试依赖 `test/e2e/package.json` main；CI 另用 glob 更稳
- REV-003：导出幂等已手工重跑零 diff，尚无自动化 lock 测试
- 讨论 md 与 greenfield 杂文件不在本 feature 范围

## 7. Final Audit

- 无 unresolved review blocking
- QA passed，核心路径有真实进程证据
- 明确不做：无 runner/migrate/adapters/profiles/evals；无 ajv/zod/joi/eslint/prettier；CLI 仅 validate
- Verdict：`passed`

## 8. Next

Goal driver：持久化 accepted + index，复核 `goal-commits` 后 scoped-commit，进入 `pi-rpc-vertical-slice`。
