---
doc_type: feature-qa
feature: 2026-07-24-evals-fixtures
status: passed
qa_id: 08471300-b093-403c-8a6f-02e70e1f1b54
model: cursor-grok-4.5-high-fast
runner_state: completed
runner_reason: ""
runner_id: ""
tested: 2026-07-28
round: 2
---

# evals-fixtures QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-design.md`（`status: approved`，`execution_lane: goal`）
- Checklist: `evals-fixtures-checklist.yaml`（steps 全 `done`；checks 仍 `pending`，留给 acceptance）
- Review: `evals-fixtures-review.md`（`status: passed`，round 1，blocking 0；important REV-001..004 未修，记入 residual）
- Evidence pack: `evals-fixtures-evidence-pack.md`
- Gate results: `evals-fixtures-gate-results.json`（scope-gate `passed`）
- DoD results: pack 内嵌 dod-runner `passed`；本轮重跑 CMD-001/002/003 均 exit 0
- Diff basis: 相对上轮 blocked，主路径修复为 `test/e2e/load-all.ts`（非 `*.test.ts`）去重 + gate-cli start 加重试；本轮只读验证，未改代码
- Baseline dirty files: 无与本 feature 无关且影响本轮判定的代码改动
- Feature type: functional（CLI `npm run evals`、台账指标、capture、种子契约）
- Core evidence gate: 真实种子一键回归；三指标/D5/exit 语义；seeds 组成与 hygiene；全量 `npm test`；tsc + biome error=0
- 上轮解除说明：round 1 blocked 因 `test/e2e/load-all.test.ts` 被 `npm test` 二次收集导致 supervisor ack timeout 等偶发失败；现入口为 `load-all.ts`（`run-tests.ts` 只收集 `*.test.ts`），本轮 `npm test` 151/151 pass，阻塞已解除

## 2. Verification Matrix

| ID | 来源 | 核心性 | 场景 / 风险 | 证据类型 | 命令或动作 | 期望 | 结果 |
|---|---|---|---|---|---|---|---|
| QA-001 | design CMD-001 | core-functional | 全量单测含公式/D5/脱敏/exit | test | `npm test` | exit 0，151 pass | pass |
| QA-002 | design CMD-002 / S1 | core-functional | 真实种子台账一键回归 | command | `npm run evals` | stdout JSON `verdict: pass`，exit 0 | pass |
| QA-003 | design CMD-003 | core-functional | 类型检查 | typecheck | `npx tsc --noEmit` | exit 0 | pass |
| QA-004 | design CMD-003 | core-functional | lint（error 级） | typecheck | `npx biome check .` | exit 0，error 级 0 | pass |
| QA-005 | design D2 / S5 | core-functional | seeds ≥5；2 clean + 1 cancelled + 2 violation；无 mock | diff + test | 读 `evals/seeds/*/seed.yaml` + hygiene | 组成正确、source 非 mock | pass |
| QA-006 | design D5 | core-functional | seeds-negative ≥4 且 npm test 含 fail verdict | test | `ledger`/`negative-metrics` | 四类分项 + 全台账 `verdict: fail` | pass |
| QA-007 | design S1 / hardening | core-functional | evaluateRun 无 meta → scope skipped；形状冻结 | unit | `packages/evals/test`（含于 npm test） | 形状与 skipped 断言绿 | pass |
| QA-008 | design exit 语义 | core-functional | unknown_expectation→1；用法错误→2 | unit | evals CLI spawn 测试 | exit 1/2 断言绿 | pass |
| QA-009 | review focus | supporting | violation seed unresolved 非空 | diff | 读 inject `result.json` | 各 ≥1 unresolved | pass |
| QA-010 | review REV-001..004 | supporting | evidence_paths 耦合 / capture source / inject prompt / 假阳性台账测 | diff | 静态复核 review | 未修；不阻塞本轮功能路径 | residual |
| QA-011 | design 明确不做 | non-functional | 无 check:research / fetch / 生产 adapter import | diff | grep `packages/evals` | check:research 零命中；adapter 仅测试/fixture | pass |
| QA-012 | design CI | non-functional | CI 矩阵含 evals | diff | `.github/workflows/ci.yml` | 含 `npm run evals` | pass |
| QA-013 | 上轮根因回归 | supporting | e2e 入口不二次收集 | diff | `test/e2e/load-all.ts` + `run-tests.ts` | 仅 `*.test.ts` 被收集；load-all 为目录入口 | pass |

## 3. Command Results

- `npm test` → exit 0：`tests 151` / `pass 151` / `fail 0`；含 evals 套件、D5、gate-cli four checkpoint、run/verify e2e
- `npm run evals` → exit 0：stdout JSON `"verdict":"pass"`；5 runs；四指标全 pass（`scope_false_positives.count=0`）
- `npx tsc --noEmit` → exit 0
- `npx biome check .` → exit 0；`Found 35 warnings`；`--diagnostic-level=error` 无 error（error 级 0）
- 未运行：none

## 4. Scenario Results

- [x] QA-001 全量 `npm test`：pass
  - Evidence: 151/151；上轮 blocked 已因 e2e 入口去重解除
- [x] QA-002 一键回归：pass
  - Evidence: 5 seed（dogfood-cancelled/clean-1/clean-2、inject-concurrent/forbidden）；metrics rate=1
- [x] QA-005 种子台账组成：pass
  - Evidence: expectation = clean×2 + cancelled×1 + violation×2；source 均为 `pi-rpc-vertical-slice:run-...`；`evals/seeds` 无 mock；mock 在 `packages/evals/test/fixtures/seeds-mock/`
- [x] QA-006 D5 可失败性：pass
  - Evidence: seeds-negative 4 目录（envelope-missing-unresolved / task-missing-field / violation-cleared-scope / evidence-missing-path）；`seeds-negative directory yields fail verdict (D5)` 与四类分项均在全量 npm test 中 pass
- [x] QA-007/008 调用面与 exit：pass（含于 npm test）
- [x] QA-009 violation unresolved：pass（inject-concurrent/forbidden 各 unresolved_len=1）
- [x] QA-013 e2e 去重：pass（`load-all.ts` 存在；无 `load-all.test.ts`）

## 5. Findings

### failed

none

### blocked

none

### residual-risk

- REV-001：`evidence_paths` 与 `validate` 耦合（诊断形状）
- REV-002：公开 `evals:capture` CLI 无法写出已入库真实 run-id source
- REV-003：inject seed 的 `prompt.md` 为 compilePrompt 重建（指标输入可信，五件「纯真实复制」对 prompt 不成立）
- REV-004：误报子指标缺台账级 fail 用例
- items.yaml 仍 `in-progress`（交 acceptance）

## 6. Cleanliness

- Debug output: pass（`packages/evals/src|bin` 无 console.log/debug）
- Temporary TODO/FIXME/XXX: pass（未新增）
- Commented-out code: pass
- Unused imports / dead code from this feature: pass（抽检）
- Out-of-scope files: pass（本轮只读，未改代码）
- Seed secrets/abs paths: pass（hygiene 测试 + 抽检）

## 7. Verdict

- Status: passed
- Next: 可进入 acceptance；residual 仅 REV-001..004 与 items.yaml，不阻塞功能验收路径。上轮 QA blocked（npm test 不稳定 / load-all 二次收集）已在本轮解除并复验通过。
