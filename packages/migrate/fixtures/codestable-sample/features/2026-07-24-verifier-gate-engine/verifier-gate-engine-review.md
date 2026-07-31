---
doc_type: feature-review
feature: 2026-07-24-verifier-gate-engine
status: passed
reviewer: subagent
reviewer_id: 12403c41-8a27-4330-abb1-38cfd6598267
model: cursor-grok-4.5-high-fast
reviewed: 2026-07-28
round: 2
lane_a_state: completed
lane_a_ref: "12403c41-8a27-4330-abb1-38cfd6598267"
lane_a_reason: ""
lane_b_state: not-started
lane_b_ref: ""
lane_b_reason: "Lane A subagent 只写本报告；OCR 由主 agent 编排"
---

# verifier-gate-engine 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-design.md`（`status: approved`，execution_lane: goal）
- Checklist: `.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-checklist.yaml`（steps 全 `done`；checks 仍 `pending`）
- Evidence pack: `.codestable/features/2026-07-24-verifier-gate-engine/verifier-gate-engine-evidence-pack.md`
- Gate results: `verifier-gate-engine-gate-results.json` / `2026-07-24-verifier-gate-engine-gate-results.json`（scope-gate `passed`，blocking/warnings 空）
- DoD results: evidence-pack 内嵌 dod-runner `passed`（CMD-001..004 exit 0）；旁路文件 `2026-07-24-verifier-gate-engine-dod-results.json` 因错误 checklist 路径为 `blocked`——以 pack 内嵌为准，但 CMD-002 截断仍为修复前证据（见 REV-013）
- Implementation evidence: `evidence/verifier-gate-engine/{observe,scope-block}/` + unit/e2e + scripts/verifier-*
- Diff basis: 工作区 unstaged/untracked；审查仅归因本 feature（忽略 packages/evals、evals/、evals-fixtures）
- Review mode: full-rereview（round 2；上一轮 changes-requested 后含默认档/e2e 接线/崩溃恢复实质修复，不可 focused closure）
- Baseline dirty files: evals-fixtures / packages/evals / role-profiles evidence 等标为范围外；共享触达 `biome.json`、`.github/workflows/ci.yml`、`scripts/run-tests.ts` 仅审与本 feature 相关增量

### Independent Review

- Detection: 本报告为独立隔离 Task agent（Cursor Grok 4.5 High Fast）；只读，不修代码
- 环节 A 独立隔离 Task agent: independent-agent + completed
- 环节 B OCR CLI: not-started（由主 agent 负责）
- OCR severity mapping: High→blocking/important, Medium→nit/suggestion, Low→discarded
- Merge policy: 本文件为 Lane A 结论；主 agent 合并 OCR 前不得因本报告单独定稿最终 `passed`（本报告已无 blocking，OCR 可用则应合并后定稿）
- Gate effect: `reviewer: subagent`；无 blocking → 可进入 Goal lane QA（important 延后须记 residual）

### Gate / provider warnings 解释

- scope-gate / dod-runner（pack 内嵌）：`warnings: []`，无未解释 blocking
- CMD-003 biome：exit 0 但 stderr 含既有/新增 `noNonNullAssertion` 等 warning（含 `gate-pipeline.test.ts`）；不升 blocking
- evidence-pack providers：`archguard` / `meta_cc` unavailable——环境能力缺失，不否定本 feature 功能证据
- pack 内嵌 CMD-002 仍显示 2 suites / 46 tests（修复前截断）——接线已修，证据未刷新（REV-013）

### Round 1 → Round 2 对照

| ID | Round 1 | Round 2 |
|---|---|---|
| REV-001 默认 enhanced | blocking 开 | 已关闭（loaders 三处默认 + unit） |
| REV-002 load-all 接 gate-cli | blocking 开 | 已关闭（`import './gate-cli.test.ts'`） |
| REV-003 四 checkpoint 恢复测 | blocking 开 | 已关闭（e2e 状态注入 + cancel） |
| REV-004 双快照固化 | important 开 | 已关闭（loadSnapshots freeze 单测） |
| REV-005 ignore IO 分叉 | important 开 | 已关闭（coordinator 级 ignore 零记录） |
| REV-006 批量/block 取消/cancel | important 开 | 部分关闭；残余见下 |
| REV-007 escalation 审计 | important 开 | 仍开 |

## 2. Diff Summary

- 新增：`packages/core/src/gate/policy-engine.ts`、`packages/core/src/schemas/gate-record.ts`、`packages/core/test/policy-engine.test.ts`、`packages/runner/src/gate/**`、`packages/runner/test/unit/{detectors,gate-pipeline}.test.ts`、`test/e2e/gate-cli.test.ts`、`fixtures/gate-record/**`、`evidence/verifier-gate-engine/**`、`scripts/verifier-*`、`.rolekit/policies/examples/**`、`.codestable/compound/verifier-gate-engine-absorption.md`、feature 目录 evidence/dod/gate JSON 与 absorption-inventory
- 修改（本轮修复热点）：`packages/runner/src/loaders.ts`（默认 `enhanced` + `loadDetectPolicy`）、`test/e2e/load-all.test.ts`（纳入 gate-cli）、`test/e2e/gate-cli.test.ts`（crash recovery + cancel）、`packages/runner/test/unit/gate-pipeline.test.ts`（default/ignore/freeze）、以及既有 `run-manager` / CLI / core registry / ADR 003 / roadmap D9 patch 等
- 删除：none（本 feature 归因）
- 未跟踪 / staged：上列新增文件多为 untracked；业务改动多为 unstaged modified
- 风险热点：跨模块（core PE + runner coordinator + CLI）、持久化/崩溃恢复、默认档行为变化、验收证据新鲜度

## 3. Adversarial Pass

- 假设的生产 bug：awaiting 恢复路径在 waitUntilSettled / gate decision 入口与 status 分叉；或 overall=block 时 confirm 未 cancelled 却仍被当 pending
- 主动攻击过的反例：默认档（缺文件/缺字段）；load-all 目录入口；pre-await 状态注入经 status/list/collect；resuming 经 status；awaiting cancel；ignore 零落盘；snapshot 改源后 loadSnapshots；higher-priority-block 缺测；PE 在 passed=false 短路；veritack API 污染；stale DoD
- 结果：上一轮 3 条 blocking 均有仓库事实关闭；higher-priority-block / 多入口全覆盖 / escalation 审计 / 过期 DoD 截断保留为 important 或 residual；无新 blocking

## 4. Findings

### blocking

none

### important

- [x] REV-001 `packages/runner/src/loaders.ts` 默认 `verifier_mode` 改为 `enhanced`（缺文件 / 缺字段 / `loadRunInput` 回落一致）；`gate-pipeline.test.ts` 断言缺 yaml 时为 enhanced
  - Evidence: diff 将三处 `'minimal'` 默认改为 `'enhanced'`，并在 enhanced 路径调用 `loadDetectPolicy`
  - Closure: 对齐 design D8 / roadmap 4.6；minimal 仍可由 fixture/`rolekit.yaml` 显式选择

- [x] REV-002 `test/e2e/load-all.test.ts` 已 `import './gate-cli.test.ts'`
  - Evidence: load-all 含三 suite import；本轮 `npm test` 观察到 suites/tests 计数相对 pack 旧截断上升
  - Closure: CMD-002 目录入口不再漏跑 gate-cli；证据刷新见 REV-013

- [x] REV-003 `test/e2e/gate-cli.test.ts` 补四窗口 mock 恢复 + awaiting cancel
  - Evidence: pre-await 经 status/list/collect 回 awaiting；注入第二 pending 后 approve 批量 resolve；resuming 经 status 收尾 completed；cancel 保留 verification 且 Envelope cancelled
  - Closure: 满足 checklist step 4 / 场景 6 的验收级自动化下限；残余入口见 REV-006

- [x] REV-004 双快照固化：`loadSnapshots keeps frozen policy/detect after source file edits`
  - Evidence: prepare 后改 gates.yaml/detect.yaml，`loadSnapshots` deepEqual 仍为旧值
  - Note: 未再断言 start 后 pipeline 运行时读 snapshot（QA 可补）

- [x] REV-005 ignore IO：`ignore action records no gates/events for hit trigger`
  - Evidence: public-api-change=ignore 时 finished、`gates.records=[]`、events 无 `type:gate`；observe 路径另有单测对照

- [ ] REV-006 多命中 / 全入口恢复覆盖仍有缺口
  - Evidence: 无 overall=block → confirm `resolution.cancelled`/`higher-priority-block` 自动化；crash e2e 未覆盖 `waitUntilSettled` 与「以 gate approve/reject 作为 pre-await reconcile 入口」；resuming 仅 status，未覆盖 collect/gate 续跑；未显式断言「不重跑 verifier / 不重复集成」
  - Impact: D4/D5/场景 11–12 部分仍靠读代码；QA 须补强，不阻塞本轮无 blocking 结论

- [ ] REV-007 escalation「仅审计」未形成可观测 audit 事件；detectors 测试名过宣称
  - Evidence: design D2 / ADR 003 delta；escalation 进入 compile-prompt 口径，未见 runner 写专用审计事件；`detectors.test.ts`「escalation does not create hits」实际只测 unresolved→ambiguous-requirement
  - Impact: 「不转 hit」成立，但「审计」证据弱

- [ ] REV-013 evidence-pack / DoD CMD-002 截断仍为修复前（2 suites / 46 tests，无 gate CLI）
  - Evidence: `verifier-gate-engine-evidence-pack.md` 内嵌 CMD-002 stdout；旁路 `2026-07-24-verifier-gate-engine-dod-results.json` 甚至因错误 checklist 路径 `blocked`
  - Impact: QA/acceptance 若只看旧截断会误判接线；须重跑 CMD-002（及必要 CMD-001）并替换证据

### nit

- [ ] REV-008 design/roadmap 文案写 `verifier:minimal|enhanced`，实现与示例统一为 `verifier_mode`。建议 D9/文档用词与代码键对齐
- [ ] REV-009 `evidence/verifier-gate-engine/scope-block/result.json` 的 `evidence` 数组未列 `gates.json`（磁盘与 events 已有 scope block record）
- [ ] REV-010 新增测试中的非空断言（如 `gate-pipeline.test.ts`）触发 biome warning；可改为局部绑定

### suggestion

- [ ] REV-011 CI 已用 `node --test "test/e2e/**/*.test.ts"`，checklist CMD-002 仍写目录形式；建议两处对齐
- [ ] REV-012 `runFinalizer` 在 enhanced 路径对 pipeline 先以 `manifest=null` 做机械短路再带 manifest 调用，可读性可再收敛

### learning

- per-run `.lock` 内禁止再调自带加锁的 `writeRunState`，须用 `writeRunStateUnlockedAt`，否则 Windows 上 awaiting 转换会死锁（compound 已记）
- ignore 零记录是 IO 层（`recordsFromEvaluation`）策略，不是 PolicyEngine 丢 hit——符合 D1
- 默认档改为 enhanced 后，fixture 项目仍显式 `verifier_mode: minimal`，既有 minimal 回归测不被动升级

### praise

- PolicyEngine 纯函数、decisions 含 ignore、overall 唯一按 block>confirm>observe>ignore 折叠，且无 IO
- `verification.passed=false` 不调用 PE；mechanical scope 固定单条 block record/event
- review-fix 对默认档 / load-all / crash recovery / ignore / snapshot 的补测对准上一轮 blocking/important
- 清洁度：API 面 / package 依赖未见 veritack/skeg 字样或包引用
- D9 roadmap/ADR 003 class-(1) 触发句已合入可见 diff

## 5. Test And QA Focus

- QA 必须重点复核：
  - 裸项目（无 `rolekit.yaml` 或仅部分字段）默认进入 enhanced：prepare 写 detect-snapshot、run 产 change-manifest、detectors 生效；显式 `verifier_mode: minimal` 仍走空 wrapper
  - 重跑并归档：`node --test test/e2e/` 与 `npm test` 均出现 `rolekit gate CLI e2e` 且全绿；替换 evidence-pack / DoD 截断（关闭 REV-013）
  - 四 checkpoint：pre-await / pending / resolution / resuming；入口扩到 waitUntilSettled 与 gate approve/reject；断言不重跑 verifier、不重复集成
  - overall=block 时 confirm record `cancelled` + `higher-priority-block`；多 pending 一次 reject；awaiting cancel 保留 candidate/patch
  - prepare/start 后改源 gates/detect，pipeline 裁定仍按 snapshot（不仅 loadSnapshots）
  - 重放 live：`scripts/verifier-live-acceptance.ts` / validate artifacts；S5 observe 审计、S6 集成前 block
- Evidence pack residual risks / gate warnings：pack 写 `none` 偏乐观；providers unavailable 已解释；CMD-002 过期截断必须刷新
- 建议新增或加强的测试：higher-priority-block；waitUntilSettled / gate decision 作 reconcile 入口；resuming 经 collect/gate；「不重跑 verifier」指纹断言
- 不能靠 review 完全确认的点：真实 Pi 并发/长时序下 reconcile 竞态；危险命令仅事后审计的诚实边界

## 6. Residual Risk

- public-api-change 路径启发式误报/漏报（半确定性）——默认 confirm / 项目可配 observe
- 无 tool_call 实时拦截——危险命令不表现为六 trigger 时 v1 不可见
- archguard / meta_cc unavailable——无独立架构/会话扫描背书
- DoD 旁路 JSON 路径错误 / pack 内嵌 CMD-002 过期——验收前刷新
- REV-006/007 未修部分——若 owner 接受延后，acceptance residual 须显式记录
- SwitchDecision/cutover 无关本条，未审

## 7. Verdict

- Status: passed
- Blocking: 0
- Important: 3（REV-006, REV-007, REV-013；REV-001..005 已关闭）
- Design fit (D1–D9): 核心契约对齐——PE 纯函数与 ignore 保留（D1）、detectors/manifest（D2）、detect loader/默认字面（D3）、pipeline 无 IO + mechanical 优先 + awaiting protocol（D4/D4a）、CLI router（D5）、gate-record 根 schema（D6）、双快照（D7）、默认 enhanced + Pipeline seam（D8）、roadmap/ADR batch patch 可见（D9）
- Next: Goal feature → `cs-feat` QA；刷新 DoD/evidence 截断；important 是否同轮修由 owner 决定并记入 residual

## 8. Focused Closure（无则写 none）

none（本轮为完整独立复审 round 2，非 focused closure）
