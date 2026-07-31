---
doc_type: feature-design-review
feature: 2026-07-24-evals-fixtures
status: passed
review_state: passed
review_reason: ""
reviewer_id: "7f13e6fd-9263-48bb-99ac-22f0bbefebcd"
reviewed: 2026-07-24
round: 3
---

# evals-fixtures feature design 审查报告

## 1. Scope And Inputs

- Design: .codestable/features/2026-07-24-evals-fixtures/evals-fixtures-design.md
- Checklist: .codestable/features/2026-07-24-evals-fixtures/evals-fixtures-checklist.yaml
- Intent / brainstorm: epic 批量 design，输入为 roadmap 条目 7
- Roadmap: .codestable/roadmap/rolekit-v2/（§3 evals 模块、§4.5 exit 约定、§5 条目 7 验收与条目 11 Envelope 完整率机械定义、Goal Coverage Matrix）
- Related docs: 上游 pi-rpc-vertical-slice design（五件产物 / D10 cancel / 验收 run 集合）、contract-schemas design（validateArtifact 两层校验 / D7.2 语义规则）

### Independent Review

- Status: completed
- Detection: heterogeneous-agent（主线 Claude 家族，reviewer Grok 4.5 High——owner 指定）
- Provider / agent: Task agent 7f13e6fd-9263-48bb-99ac-22f0bbefebcd
- Raw output: round 1 FDR-001..010、round 2 闭合核对 + FDR2-001..003、round 3 focused closure 确认，全文见回传
- Merge policy: 每条经主 agent 本地核验（条目 11 机械定义原文 / contract-schemas D7.2 / pi-rpc D10 比对）后合并；无照抄
- Gate effect: round 1 changes-requested（5 important，无 blocking），round 2 确认 FDR-001..005/007..010 闭合、FDR-006 部分残留并新增 FDR2-001（important）+ FDR2-002/003（nit），round 3 focused closure 确认全闭合、passed

## 2. Design Summary

- Goal: 三指标机械评测（契约完整率 / 写入越界检出+误报双子指标 / Envelope 完整率）——种子取自 pi-rpc 验收 run 真实产物（capture 脚本 + 脱敏 + 准入门闩），纯离线重放，`npm run evals` 一键回归带阈值 exit 语义
- Key contracts: 调用面冻结 `evaluateRun(runDir, meta?)`（hardening 条目 11 无 meta 模式复用，单一事实源）；Envelope (i)+(ii) = core validateArtifact（语义规则不写第二份）；读取源钉死（越界只读 verification.json / Envelope 只读 result.json，不交叉比对）；RunEvalResult 形状冻结（envelope.pass 合取、scope='skipped' ⇔ 无 meta ∨ cancelled）；expectation 三值封闭；seeds-negative 四类可失败性证明
- Steps: 6（S1 指标函数、S2 台账+exit、S3 capture、S4 负例、S5 真实种子、S6 CI+收口）
- Checks: 12，来源字段齐全
- Baseline / validation: 实现前置 pi-rpc 严格 done（真实种子来源），S1-S4 可先行于 mock 种子；三命令矩阵，Windows 本机

## 3. Findings

### blocking

none

### important

- [x] FDR-001 hardening 复用的单一事实源未冻成可调用契约——已修：meta 可选、无 meta 时 scope='skipped'、RunEvalResult 形状冻结 + 形状断言
- [x] FDR-002 Envelope 完整率与 validateArtifact 关系未钉——已修：(i)+(ii) = 对 result.json 调 validateArtifact，语义单一实现在 core
- [x] FDR-003 scope_violations 读取源未钉——已修：越界只读 verification.json、Envelope 只读 result.json，明示不交叉比对（一致性归 runner 组装所有权）
- [x] FDR-004 真实种子入库准入未冻结——已修：capture 准入门闩（seed_rejected exit 1 归因上游）+ violation seed unresolved 非空断言
- [x] FDR-005 check:research 禁引无机械核对——已修：grep 门闩（check:research|check-research|checkResearch 零命中）
- [x] FDR2-001 cancelled 的 scope 与 capture 判据未钉——已修：scope='skipped' ⇔ 无 meta ∨ cancelled；准入按 expectation 三值分派

### nit

- [x] FDR-006 负例未覆盖 evidence 路径缺失——已修：seeds-negative 扩至 ≥4 类（round 2 发现残留计数，round 3 全文统一）
- [x] FDR-007 mock 种子降级路径未钉——已修：packages/evals/test/fixtures/seeds-mock/ + evals/seeds/ 无残留断言
- [x] FDR-008 exit 语义 e2e 挂载不清——已修：挂 npm test（spawn evals CLI）
- [x] FDR2-002 三处旧计数残留——已修（grep 确认零残留）
- [x] FDR2-003 envelope.pass 合取关系未写死——已修

### suggestion

- [x] FDR-009 cancelled 验收句——已采纳（场景 2）
- [x] FDR-010 Goal Matrix Core? 维度脚注——已采纳

### learning

- 共享判定函数的"单一事实源"主张必须落到调用面签名与输出形状冻结，光声明复用不构成契约
- 评测台账的入库准入门闩（采集时即验证达预期）是防"台账永红难归因"的关键闸门

### praise

- expectation 三值封闭 + unknown_expectation 不猜；越界用标签驱动而非运行时推断
- seeds-negative 独立目录防假绿，四类与指标分项一一对应
- capture 作为种子入库唯一通道 + 脱敏自检

## 4. User Review Focus

- 用户需要重点拍板（epic 批量确认时）：无单列决策项（本条为纯机械评测基建；evaluateRun 与 hardening 的共享契约作提示项）
- implement 需要重点遵守：D1 公式与读取源；RunEvalResult 形状；准入门闩；阈值硬冻结 100%/0
- code review / QA / acceptance 需要重点复核：种子来源链（seed.yaml 与采集脚本输出一致性）；脱敏 grep；可失败性断言

## 5. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| D1 公式 vs 条目 11 定义 | pass | E | 三条 + 分母表述逐字比对；validateArtifact 复用钉死 | none |
| 单一事实源调用面 | pass | E | meta 可选 + 形状冻结 + 形状断言单测 | none |
| 种子来源链与可失败性 | pass | E | capture 唯一通道 + 准入门闩 + 四类负例 | none |
| exit / Matrix / checklist 一致性 | pass | E | 0/1/2 对齐 4.5；Matrix 10 行 + 维度脚注 | none |
| 范围守护机械核对 | pass | E | 依赖审计 + check:research grep 门闩 | none |

Summary: E=5, C=0, H=0, H-only core checks=none。

## 6. Residual Risk

- 上游 failed Envelope 若缺 unresolved，准入门闩会拒绝种子并归因上游（不再是 evals 台账永红）
- 阈值硬 100%/0 遇 dogfood 合理例外需 roadmap update（观察项已留）

## 7. Verdict

- Status: passed
- Next: epic 批量上下文，design 保持 draft，交回 cs-epic 继续下一个子 feature；用户确认延后到全部 child design-review passed 后统一进行

## 8. Focused Closure

- Closed findings: FDR2-001, FDR2-002, FDR2-003
- Attributed delta: design D1 scope 判据与合取/D2 准入分派/2.4§4/交付物/Required Artifacts 计数；checklist 调用面 check 同步
- Verification: 修订后 checklist 过 validate-yaml.py；grep 确认无 ≥3/三类残留；scope 判据与 D3 归类规则一致
- Classification: 语义澄清与计数同步（不改变行为契约与验收范围）；reviewer round 3 确认 passed 无新问题
