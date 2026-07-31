---
doc_type: feature-review
feature: 2026-07-24-pi-rpc-vertical-slice
status: passed
reviewer: subagent
reviewed: 2026-07-28
round: 2
lane_a_state: completed
lane_a_ref: ""
lane_a_reason: ""
lane_b_state: unavailable
lane_b_ref: ""
lane_b_reason: "ocr CLI present but LLM endpoint not configured (ocr llm test failed); local line review performed"
---

# pi-rpc-vertical-slice 代码审查报告（round 2 / Material 复审）

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-design.md`（`status: approved`）
- Checklist: `.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-checklist.yaml`（steps 全 `done`；checks 仍 `pending`）
- Evidence pack: `.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-gate-results.json`（scope-gate `passed`，blocking 空；已含 `.gitignore` / `biome.json`）
- DoD results: evidence pack 内嵌 DoD runner；CMD-005 断言 `verification.passed===true` 且 exit 0
- Implementation evidence: `evidence/pi-rpc-vertical-slice/{smoke,dogfood,inject}/` + runner 单测/e2e
- Diff basis: Material 复审——相对 round 1 增量含 inject harness/证据、`skipPrimaryConcurrent`、verify 断言加固、IntegrationManager fillPostDigests；工作区仍含完整 `packages/runner/**` 与 CLI/scripts
- Review mode: full-rereview（Material；round 1 → 2）
- Baseline dirty files: roadmap/items/goal-state、`.gitignore`、`biome.json` 等归本 feature；与 scope-gate `changed_files` 对齐

### Independent Review

- Detection: 本轮为独立隔离 Task agent（Cursor Grok 4.5 High）；`ocr` 二进制存在但 `ocr llm test` 因无 LLM endpoint 失败 → OCR unavailable
- 环节 A 独立隔离 Task agent: independent-agent + completed
- 环节 B OCR CLI: unavailable
- OCR severity mapping: High→blocking/important, Medium→nit/suggestion, Low→discarded
- Merge policy: 本报告为环节 A 核验结论；OCR 未启用，已用本地行级审查补足
- Gate effect: `reviewer: subagent`；无 blocking，可放行下游

### Prior Blocking Closure

| ID | Round 1 | Round 2 核验 | 结论 |
|---|---|---|---|
| REV-001 | 缺阶段 3 真机注入证据 | `evidence/.../inject/{forbidden,concurrent}/`：Pi adapter、Envelope `failed`、`scope_violations`、events `gate`/`action:block`；`SUMMARY.md` forbidden=true concurrent=true | closed |
| REV-002 | reverify 扫主区致 dogfood 假红 | `MinimalVerifier` + `reverify(..., skipPrimaryConcurrent: true)`；最新 reverify artifact `verification.passed===true`；DoD CMD-005 绿 | closed |

## 2. Diff Summary

- 新增：`packages/runner/**`、`compile-prompt`、CLI project、`scripts/{pi-rpc-smoke,pi-inject-harness,dogfood-harness,verify-dogfood-run}.ts`、e2e run-cli/load-all、evidence（smoke/dogfood/inject）
- 修改（相对 round 1 关键）：`verifier.ts`（`skipPrimaryConcurrent`）、`run-manager.ts` reverify 传参、`integration-manager.ts`（fillPostDigests/verifyPost）、`verify-dogfood-run.ts` / e2e 断言 `passed===true`、inject harness + 证据、scope-gate 文件列表
- 删除：none
- 未跟踪 / staged：runner 包与大量 feature 产物仍 untracked（evidence gitignore）
- 风险热点：reverify 语义边界、Integration post digest、阶段 3a 注入方式（harness 写 worktree）、跨进程 supervisor

## 3. Adversarial Pass

- 假设的生产 bug：Integration `fillPostDigests`→`verifyPost` 自证循环，apply 后部分损坏仍无法机械失败
- 主动攻击过的反例：design 不一致（阶段 3a 非 Pi 写 forbidden）、边界（JSONL）、错误路径（cancelled verify）、状态（finalizing cancel）、并发（primary inject）、持久化（post digest 空转）、测试假阳性（CMD-005 已修）
- 结果：REV-001/002/003/005 关闭；REV-004 仍 important；3a harness 注入记 residual；无新 blocking

## 4. Findings

### blocking

- none

### important

- [x] REV-001 （closed）阶段 3 真机注入证据已留存
  - Evidence: `inject/forbidden|concurrent` 含 result/verification/events/run-state；adapter=`pi-rpc`；forbidden `scope_violations:["forbidden:forbidden-out.txt"]` + gate block；concurrent `concurrent-change: added src/seed.txt` + gate block；SUMMARY 双 true
  - Note: 3a 由 harness 在 prepare 后/start 前写入 worktree（非 Pi tool 写），但仍走真实 Pi 会话与 scope gate；见 Residual Risk

- [x] REV-002 （closed）reverify 跳过主区 concurrent；dogfood `passed=true`
  - Evidence: `verifier.ts:74-83` + `run-manager.ts:429-431`；`reverify-2026-07-28T09-12-0{1,2}-*.json` 均为 `passed:true` / `scope_violations:[]`；CMD-005 stdout 双 `passed=true`

- [x] REV-003 （closed）CMD-005 / e2e 断言 `verification.passed===true`
  - Evidence: `scripts/verify-dogfood-run.ts:40-44`；`test/e2e/run-cli.test.ts:55`；DoD CMD-005 exit 0

- [ ] REV-004 `packages/runner/src/integration-manager.ts:146-151,196-207,241-254` D12 post digest 仍未真正兑现
  - Evidence: apply 后 `fillPostDigests` 从主区读实际 bytes 填入 `post_digest`，随即 `verifyPost` 再读同一路径比对——恒真（仅 TOCTOU 可失败）。未从验证后候选 worktree 预计算期望 post/mode digest 再与 apply 结果核对。`integration-result.json` 的 `post_digest` 仍为 plan JSON 哈希。
  - Impact: apply 后部分错写/损坏难以被机械检出；checklist「失败 digest rollback」相关 check 仍不可完全信任。
  - Expected fix scope: 在 apply 前从候选 worktree 填充期望 post（及 mode）digest；apply 后只做比对；失败走 backup。可延后但须进 acceptance residual。

- [x] REV-005 （closed）scope-gate `changed_files` 已含 `.gitignore` / `biome.json`

### nit

- [ ] REV-006 `packages/runner/src/executors/pi-rpc.ts:254` summary 固定 `slice(0,500)`，审计可读性差（同 round 1）

### suggestion

- [ ] REV-007 e2e 增加 reverify 前后主区 digest 不变断言（design 场景 17）
- [ ] REV-008 为 `skipPrimaryConcurrent` 增加 unit：主区已集成/HEAD 漂移时 reverify 仍 `passed`

### learning

- Windows `pi.cmd` 需 `cmd.exe /c`；cancel 用 `taskkill /t /f`；JSONL 禁用 readline 拆 U+2028/U+2029——应沉淀 attention/compound。
- 阶段 3a 在 Pi 过快结束时可用 harness 预置 worktree 越界文件，但仍须保留真实 Pi 会话事件链。

### praise

- review-fix 对 REV-001/002 证据链完整：inject 目录 + skipPrimaryConcurrent + dogfood reverify 绿 + CMD 断言加固。
- 范围守护仍在：无 steer、拒 in-place、无 GateEvaluation 引擎。
- D13 finalizer / finalizer-races 覆盖仍可信。

## 5. Test And QA Focus

- QA 必须重点复核：
  - 阶段 3：inject 两目录产物与 gate(block)；确认 3a 接受 harness 预置或补一次 Pi 实写 forbidden
  - 阶段 4：两成功 run `rolekit verify` → `verification.passed===true`；cancelled → `run_not_verifiable`（已有 `verify-cancel.json`）
  - Integration apply 失败回滚与（若未修）post digest 空洞风险
  - finalizing 窗口 cancel、report-vs-intent、supervisor kill 后 deadline 懒补
- Evidence pack residual / gate warnings：
  - archguard / meta_cc unavailable（非 blocking）
  - biome 25 warnings，exit 0
  - evidence pack 写 `Residual Risks: none`——以本报告 REV-004 / 3a 注入语义为准
- 建议加强：unit（reverify+主区漂移）、e2e（主区 digest 不变）、Integration post digest 真比对
- 不能靠 review 完全确认：Windows crash 注入全矩阵；enhanced/detect 路径（本条 minimal）

## 6. Residual Risk

- REV-004：post digest 自证循环未修——acceptance 勾 D12/integration check 时须重点复核或先修
- 阶段 3a：forbidden 文件由 harness 写入 worktree，非 Pi tool 写出；机械 exit_signal 已满足，语义完整度依赖 QA 是否要求 Pi 实写
- checklist `checks` 仍全部 pending——acceptance 前机械勾选，不得用 steps.done 代替
- Provider 扫描缺失不阻塞 acceptance

## 7. Verdict

- Status: passed
- Blocking: 0
- Important open: 1（REV-004；REV-003/005 已关）
- Next: Goal lane → `cs-feat` QA；REV-004 写入 QA/acceptance residual（或先小修再 QA）

## 8. Focused Closure（无则写 none）

- none（本轮为 Material 完整独立复审，非 focused closure）
