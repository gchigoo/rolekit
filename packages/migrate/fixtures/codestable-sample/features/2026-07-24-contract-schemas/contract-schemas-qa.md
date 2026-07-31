---
doc_type: feature-qa
feature: 2026-07-24-contract-schemas
status: passed
qa_date: 2026-07-28
reviewer: subagent
---

# contract-schemas QA 报告

## 1. Scope

- Feature: `2026-07-24-contract-schemas`
- Design / Acceptance Matrix: `contract-schemas-design.md` §3 / §3.x
- Checklist: steps 全 `done`；checks 仍 `pending`（由 acceptance 回写）
- Review: `contract-schemas-review.md`（`status=passed`；REV-001 已闭合；QA focus = REV-002 / REV-003）
- Evidence pack / gate / DoD: 均为 `passed`，blocking 空
- Roadmap: rolekit-v2 §4.1–4.10；Goal 规格 `goal-features/contract-schemas.md`
- 验证环境: Windows；Node `v24.15.0`；npm `11.12.1`
- 方式: 只读产品代码；真实执行 DoD 四命令 + spawn `packages/cli/bin/rolekit.js validate`

## 2. QA Matrix

| Scenario | Result | Evidence |
|---|---|---|
| 9 类正例 fixture → 真实 CLI exit 0 | pass | 手工 spawn 9 正例均 `exit=0 valid=true`；e2e 同覆盖 |
| 9 类结构负例 → exit 1 + `layer: structural` | pass | 每类 ≥1 结构负例手工确认 layers=structural；`invalid-wrong-schema` 为 `unknown_schema`（与 review learning / design 场景 5 一致） |
| 4 类语义负例 → exit 1 + `layer: semantic` | pass | empty-commands / completed-with-violations / awaiting-gate-null / adr-missing-headings / rule-multipart 均 layers=semantic |
| ExecutorProfile 未内置 adapter 正例 valid；空串 structural | pass | `valid-openai-responses` exit 0；`invalid-empty-adapter` structural |
| WorkItem `kind=goal` 可接受；goal→done 完成不变量不在 schema 层 | pass | 单测 accepts kind=goal；临时 `goal+done+depends_on 未齐` fixture validate exit 0 |
| `compileTask` 正例深等 + 深冻结；错例字段级 issues | pass | `node --test packages/core/test/compile-task.test.ts` 3/3；含 `Object.isFrozen` |
| CLI exit 0/1/2；`--json` 仅 JSON；help 仅 validate | pass | 缺参/未知 flag/未知命令 → 2；help 仅 validate 表面 |
| 空文件 / UTF-8 BOM → `parse_error` 不崩溃 | pass | empty/BOM 均 exit 1 code=parse_error |
| 缺 schema / 未知 kind → `unknown_schema` | pass | noschema / does-not-exist@1 均 exit 1 code=unknown_schema |
| JSON Schema 导出 9 份且重跑零 diff | pass | `schemas/json` 恰好 9；`npm run export:schemas` 后 sha256 零 diff |
| 范围守护：无 ajv/zod/joi/eslint/prettier；packages 仅 core+cli；private | pass | rg 无违禁依赖；`packages/`=cli,core；`private:true` 无 publishConfig |

## 3. DoD Commands

| ID | Command | Exit | Notes |
|---|---|---|---|
| CMD-001 | `npm test` | 0 | 62 pass / 0 fail |
| CMD-002 | `npx tsc --noEmit` | 0 | 无输出 |
| CMD-003 | `npx biome check .` | 0 | Checked 33 files |
| CMD-004 | `node --test test/e2e/` | 0 | 37 pass（Node 24 目录形式） |
| CMD-004' | `node --test "test/e2e/**/*.test.ts"` | 0 | CI 同形；与目录形式结果一致 |

结论: 四条核心命令全部 exit 0；未 fail-closed。

## 4. Review Focus Follow-up

| ID | Focus | QA Result |
|---|---|---|
| REV-001 | compileTask freeze | **closed / pass**：`deepFreeze` + `Object.isFrozen` 单测 3/3 |
| REV-002 | Node24 e2e 目录形式 vs CI glob | **本机 Node 24.15.0 两种调用均 exit 0**；调用形式仍未统一（checklist/DoD 用目录，CI 用 glob）→ 记 residual，不升格 failed |
| REV-003 | export 零 diff 自动化锁定 | **人工重跑零 diff 通过**；DoD/CI 仍无自动锁 → 记 residual，不升格 failed |

## 5. Residual Risks

1. REV-002：CMD-004 与 CI e2e 调用字符串不一致；当前 Node 24.15.0 两边都绿，但不能保证 engines 全区间永远同行为——建议统一为显式 glob 或 `scripts/run-tests.ts` 子集。
2. REV-003：导出幂等仅靠人工/QA 重跑；无 test/CI step 锁 `npm run export:schemas` 后零 diff。
3. Evidence pack Residual Risks 写 `none`；审查已补充上述两项——本 QA 采纳审查补充，不采纳 pack 的「无风险」表述。
4. `rolekit-v2-items.yaml` 仍 `in-progress`（预期 acceptance 回写）。
5. ISO8601 字段仅 `minLength:1`（REV-007）——契约外收紧项，不阻塞本条。
6. Provider `archguard` / `meta_cc` unavailable——工具缺失，非实现缺陷。

## 6. Findings

### failed

none

### blocked

none

## 7. Verdict

- **status: passed**
- failed count: **0**
- blocked count: **0**
- 核心路径（真实 `rolekit validate` 遍历正/负 fixture、exit 0/1/2、结构/语义分层、compileTask 冻结、导出零 diff、DoD 四命令）全部实测通过。
- 未闭合 important（REV-002/REV-003）保留为 residual；不阻断 QA pass。
- Next: Goal lane → acceptance（回写 checklist checks / items.yaml / CONTEXT）。
