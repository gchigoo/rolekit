---
doc_type: feature-review
feature: 2026-07-24-evals-fixtures
status: passed
reviewer: subagent
reviewer_id: 6c32001f-7990-4f89-8872-f3e34198849b
model: cursor-grok-4.5-high-fast
reviewed: 2026-07-28
round: 1
lane_a_state: completed
lane_a_ref: "6c32001f-7990-4f89-8872-f3e34198849b"
lane_a_reason: ""
lane_b_state: not-started
lane_b_ref: ""
lane_b_reason: "Lane A subagent 只写本报告；OCR 由主 agent 编排"
---

# evals-fixtures 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-design.md`（`status: approved`，`execution_lane: goal`）
- Checklist: `.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-checklist.yaml`（steps 全 `done`；checks 仍 `pending`）
- Evidence pack: `.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-evidence-pack.md`
- Gate results: `evals-fixtures-gate-results.json`（scope-gate `passed`，blocking/warnings 空）
- DoD results: evidence-pack 内嵌 dod-runner `passed`（CMD-001/002/003 exit 0）；旁路 `2026-07-24-evals-fixtures-dod-results.json` 因错误 checklist 文件名 `blocked`——以 pack 内嵌为准
- Implementation evidence: memory-bank `evals-fixtures-impl.md`；本机复核 `npm run evals` exit 0、`node --test packages/evals/test/*.test.ts` 29/29 pass
- Diff basis: 工作区 untracked `packages/evals/**`、`evals/**` + modified `ci.yml` / `biome.json` / `scripts/run-tests.ts` / checklist；`package.json` 的 `evals`/`evals:capture` 已在 HEAD
- Review mode: initial（Lane A 独立隔离 Task agent）
- Baseline dirty files: verifier-gate-engine 已提交内容忽略；CI 同文件内 `lint:profile-fragments` / `validate:profiles` 视为范围外混入（见 nit）

### Independent Review

- Detection: 本报告为独立隔离 Task agent（cursor-grok-4.5-high-fast）；只读，不修代码
- 环节 A 独立隔离 Task agent: independent-agent + completed
- 环节 B OCR CLI: not-started（由主 agent 负责）
- OCR severity mapping: High→blocking/important, Medium→nit/suggestion, Low→discarded
- Merge policy: 本文件为 Lane A 结论；主 agent 合并 OCR 前不应因本报告单独定稿最终 gate（本报告无 blocking）
- Gate effect: `reviewer: subagent`；无 blocking → Goal lane 可进 QA（important 须记 residual 或先修）

### Gate / provider warnings 解释

- scope-gate / dod-runner（pack 内嵌）：`warnings: []`，无未解释 blocking
- CMD-003 biome：exit 0，stderr 含仓库既有 warning（非 evals 包引入）
- evidence-pack providers：`archguard` / `meta_cc` unavailable——环境能力缺失，不否定本 feature 功能证据
- Residual risks（pack）：`none`

## 2. Diff Summary

- 新增：`packages/evals/**`（evaluate/ledger/capture/redact/CLI/tests/mock fixtures）、`evals/seeds/{dogfood-clean-1,dogfood-clean-2,dogfood-cancelled,inject-forbidden,inject-concurrent}/`、`evals/seeds-negative/{envelope-missing-unresolved,task-missing-field,violation-cleared-scope,evidence-missing-path}/`、feature 目录 evidence/gate/dod 产物
- 修改：`.github/workflows/ci.yml`（`npm run evals`）、`biome.json`（排除 seed/fixture）、`scripts/run-tests.ts`（纳入 `packages/evals/test`）、checklist steps→done
- 删除：none（本范围）
- 未跟踪 / staged：上述新增均为 untracked；无 staged
- 风险热点：种子来源链与脱敏（安全/数据）、指标公式与 hardening 共享 seam、CI 矩阵；无新增 core schema、无网络/executor

## 3. Adversarial Pass

- 假设的生产 bug：种子来源链不纯或指标形状与 D1 漂移，导致 hardening 复用或「永远绿」假回归
- 主动攻击过的反例：
  - D1 公式 / 阈值 / scope skipped 语义 vs `evaluate.ts`+`ledger.ts`
  - D2 五件产物 + seed.yaml source 与上游 evidence / capture CLI 一致性
  - D5 四类负例分项 + 全台账 fail
  - 脱敏泄漏、mock 残留于 `evals/seeds`
  - exit 0/1/2、check:research 复用、core schema 新增
- 结果：升级为 important 的项见 Findings；其余由 QA focus / residual 覆盖

## 4. Findings

### blocking

none

### important

- [ ] REV-001 `packages/evals/src/evaluate.ts:70` `evidence_paths` 与 `validate` 耦合
  - Evidence: `evidencePass = validatePass && evidencePathsPass(...)`；D1 形状冻结为两字段独立再合取 `envelope.pass`。validate 失败时即使路径齐全也会报 `evidence_paths: fail`
  - Impact: hardening / 诊断消费者无法区分「语义校验失败」与「证据路径缺失」
  - Expected fix scope: 独立计算 `evidence_paths`，`pass` 仍为合取；补一条「validate fail + paths ok」形状断言

- [ ] REV-002 `packages/evals/src/cli-capture.ts:32` capture CLI 无法写入真实 run-id source
  - Evidence: CLI 固定 `source: pi-rpc-vertical-slice:${name}`；入库种子为 `pi-rpc-vertical-slice:run-20260728-...`。D2 要求 review 抽检 source/captured 与采集脚本输出一致——公开 `npm run evals:capture` 无法产出当前 seed.yaml
  - Impact: 「采集脚本唯一通道」契约不闭合；后续扩容种子易写错 source
  - Expected fix scope: CLI 接受 run-id/source（或从 run-state 读取），与现有种子元数据对齐；或文档化并测试仅允许的 API 捕获入口

- [ ] REV-003 `evals/seeds/inject-*/prompt.md` 非上游封印产物原文
  - Evidence: `evidence/pi-rpc-vertical-slice/inject/{forbidden,concurrent}/` 无 `prompt.md`；impl 记录为 compilePrompt 重建。`task.json`/`result.json`/`verification.json` 与 evidence 一致（diff 空）；dogfood 三 seed 的 prompt 与 run 目录一致
  - Impact: 指标输入（task/result/verification）可信；五件产物「真实复制」对 inject 的 prompt 不成立
  - Expected fix scope: 在 seed.yaml/notes 或 compound 标明 prompt 重建；或从可复现 compile 步骤固化并加 hygiene 断言

- [ ] REV-004 误报子指标缺台账级失败测试
  - Evidence: `evaluate.test.ts` 覆盖 clean+violations → `detected: true`；无 `evaluateLedger`/`CLI` 断言 `scope_false_positives` 超阈 → `verdict: fail`（design 场景 6）
  - Impact: 聚合层回归可能漏检
  - Expected fix scope: 增一条 ledger（或 spawn CLI）假阳性失败用例

### nit

- [ ] REV-005 `.github/workflows/ci.yml` 同 diff 混入 `lint:profile-fragments` / `validate:profiles`（非本 feature 范围）
- [ ] REV-006 `packages/evals/src/redact.ts:13` 硬编码本机用户名 `steven.guo`——可维护性弱，建议配置化或通用 Users\\&lt;name&gt; 模式

### suggestion

- [ ] REV-007 capture CLI 可从 `run-state.json` / 目录名自动推断 `source`，减少人工参数

### learning

- inject evidence 未封印 `prompt.md`（sealRun 省略）时，evals 五件契约会倒逼重建；后续 runner 封印应保证 prompt 落盘，避免种子半合成
- `evaluateRun` 无 meta 模式与 ledger 有 meta 模式共用同一函数，是 hardening 条目 11 的正确 seam

### praise

- D1 三指标阈值、scope skipped 语义、负例四类分项与 hygiene（无 mock / 脱敏 / violation unresolved）测试扎实；`npm run evals` 对 5 真实种子 exit 0
- 明确不做项落实：`packages/evals` 无 check:research / fetch / runner adapter；报告类型自持于 evals 包

## 5. Test And QA Focus

- QA 必须重点复核：
  - `npm run evals` 对 `evals/seeds` 三指标全绿、exit 0（本机已绿，QA 复跑）
  - `npm test` 内 D5：`seeds-negative` 四类分项 + 全台账 fail；CLI exit 2 / unknown_expectation exit 1
  - 种子来源链：5 seed 的 `source` run-id 与 `evidence/pi-rpc-vertical-slice` 对齐；inject prompt 重建是否可接受并文档化（REV-003）
  - 脱敏自检：对 `evals/seeds` 全量跑 `findForbiddenLeak`（hygiene 测试已覆盖，QA 抽检 events.jsonl）
  - hardening 复用：`evaluateRun(dir)` 无 meta → scope skipped；形状键集合冻结
  - capture：对 mock run 走 `evals:capture` 后检查 seed.yaml source 是否可接受（关联 REV-002）
- Evidence pack residual risks / gate warnings：pack 记 none；旁路错误文件名 dod-results 忽略
- 建议新增或加强的测试：ledger 假阳性失败（REV-004）；`evidence_paths` 独立于 validate（REV-001）
- 不能靠 review 完全确认的点：inject prompt 重建是否与当时 compilePrompt 字节级一致；items.yaml 仍为 `in-progress`（通常 acceptance 收口）

## 6. Residual Risk

- inject seed 的 `prompt.md` 半合成（不影响当前三指标计算，影响「纯真实复制」叙事）——QA/acceptance 需显式接受或补文档
- capture 公开 CLI 与已入库 source 不一致——扩容种子前应先修 REV-002
- `rolekit-v2-items.yaml` 中 evals-fixtures 仍 `in-progress`——交 acceptance 回写
- scope-gate 文件列表含 verifier-gate 等混杂路径——归因噪音，不否定 evals 本身

## 7. Verdict

- Status: passed
- Blocking: 0 / Important: 4
- Next: 主 agent 合并 Lane B（若启用）后定稿；Goal lane → QA。建议 QA 前处理或正式接受延后 REV-001..004

## 8. Focused Closure（无则写 none）

none
