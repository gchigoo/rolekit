---
doc_type: feature-design-review
feature: 2026-07-24-contract-schemas
status: passed
review_state: passed
review_reason: ""
reviewer_id: "284ac318-7153-4596-a051-3898ca310b91"
reviewed: 2026-07-24
round: 2
---

# contract-schemas feature design 审查报告

## 1. Scope And Inputs

- Design: .codestable/features/2026-07-24-contract-schemas/contract-schemas-design.md
- Checklist: .codestable/features/2026-07-24-contract-schemas/contract-schemas-checklist.yaml
- Intent / brainstorm: none（epic 批量 design，输入为 roadmap 条目）
- Roadmap: .codestable/roadmap/rolekit-v2/（主文档 §3/§4.1-4.10/§5 条目 1 + items.yaml）
- Related docs: requirements/CONTEXT.md、adrs/004、adrs/005
- Code facts checked: greenfield（无源码）；roadmap 4.5/4.7/4.10 原文逐条核对

### Independent Review

- Status: completed
- Detection: heterogeneous-agent（主线 Claude 家族，reviewer Grok 4.5 High——owner 指定）
- Provider / agent: Task agent 284ac318-7153-4596-a051-3898ca310b91
- Raw output: round 1 FDR-001..016、round 2 闭合核对 + FDR2-001..008，全文见回传
- Merge policy: 每条经主 agent 本地核验（roadmap 4.5/4.7/4.10 原文比对）后合并；无照抄
- Gate effect: round 1 changes-requested（2 blocking），修订后 round 2 完整复审确认原 finding 全闭合、无 blocking；FDR2-001/002（important）与 FDR2-003/004（nit）按 reviewer 指示走 focused closure（见第 8 节）

## 2. Design Summary

- Goal: 9 类 TypeBox 契约 schema + 两层校验（结构/语义）+ JSON Schema 导出 + compileTask + rolekit validate 最小 CLI + monorepo/CI 基线
- Key contracts: seam = validateArtifact / compileTask（roadmap 4.1）；字段权威 = roadmap 4.1-4.10 不重抄；KnowledgeEntry .md 载荷 { frontmatter, body }；exit 0/1/2 对齐 4.5；adapter 非空 string 不枚举对齐 4.7
- Steps: 7（S1 基线、S2 最难 schema spike、S3 其余 schema、S4 语义规则、S5 JSON Schema 导出、S6 compileTask+CLI、S7 fixture 收口）
- Checks: 15，来源字段齐全
- Baseline / validation: greenfield 无红灯；四命令矩阵（test/typecheck/lint/CLI e2e），Windows 本机为第一验证环境

## 3. Findings

### blocking

- [x] FDR-001 `design#D7.5` KnowledgeEntry type 断言被误归 knowledge-layer，违反 roadmap 4.10——已修：本条交付 .md frontmatter 校验 + adr 四节/rule 单段断言
- [x] FDR-002 `checklist.step1` S1 退出信号要求 CLI e2e 但 CLI 在 S6 才交付——已修：S1 改三命令绿 + 空 harness，真实 e2e 归 S6/S7

### important

- [x] FDR-003 D7 语义规则与 S7"语义各一"不对齐——已修：新增 D8 分层负例策略
- [x] FDR-004 4.7 adapter 非枚举约束未显式落地——已修：D7.6 + 名词层钉死 + check
- [x] FDR-005 fixture 验收未强制真实 CLI 路径——已修：S7 spawn rolekit validate 遍历
- [x] FDR-006 compileTask 无独立可证伪出口——已修：S6 退出信号 + Matrix core 行
- [x] FDR-007 缺 exit 2 用法错误路径——已修：CLI 流对齐 4.5，场景 + check 同步
- [x] FDR2-001 adapter 空串被误标 semantic（4.7 属结构约束）——已修：minLength:1 结构负例，D8 集合缩为 4 类
- [x] FDR2-002 CMD-001 目的表述可绕过 CLI 字面验收——已修：注明不替代 CLI fixture

### nit

- [x] FDR-008 CONTEXT.md kinds 缺 goal 的漂移说明——已加注"以 4.9 为准，acceptance 回写"
- [x] FDR-009 Pi 版本矩阵归属未说明——已注明属 pi-rpc-vertical-slice
- [x] FDR2-003 "纯函数无 IO"与路径输入矛盾——已澄清 IO 归 CLI/loader
- [x] FDR2-004 KnowledgeEntry 载荷是否含 body 未写明——已补载荷约定

### suggestion

- [x] FDR-011 unknown_schema 稳定错误码——已采纳
- [x] FDR2-005 ExecutorReport 不复制 Envelope 语义的说明——已采纳（D8 尾注）
- [ ] FDR-010 compileTask 与 CLI 拆两步——未采纳（FDR-006 修复后原子性已足）

### learning

- greenfield"现状：全新"+ 引用 roadmap 不重抄字段的策略成立，S3 逐字段自查表是正确的防漂移补偿
- KnowledgeEntry 是 9 类中唯一 .md 载荷的 schema，校验入口的格式切分边界必须在 design 期钉死

### praise

- S2 先 spike 最难 schema（RunEvent 7 变体 union / WorkItem 条件 gate）、D8 分层负例、明确不做反向核对、D6 scope 假设含回退——利于 epic 批量 design 防漂移

## 4. User Review Focus

- 用户需要重点拍板（epic 批量确认时）：D5 lint 用 Biome、D6 npm scope `@rolekit`（含 `@rolekit-dev` 回退）
- implement 需要重点遵守：字段权威 = roadmap 4.1-4.10；两层校验短路顺序；core 无 IO；CLI 薄壳 exit 0/1/2；fixture 验收必须走真实 CLI
- code review / QA / acceptance 需要重点复核：S2 spike 证据（TypeBox 表达力）；S7 真实 CLI 遍历证据；CONTEXT.md goal kind 回写

## 5. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Acceptance Coverage Matrix | pass | E | 9 行矩阵，核心场景全有 step/证据/命令 | none |
| DoD Contract | pass | E | 5 DoD + 4 CMD，与 checklist dod.commands 字段一致 | none |
| Steps and checks traceability | pass | E | 7 steps 退出信号可判定；15 checks 均可回溯 design | none |
| Roadmap contract compliance | pass | E | 4.1/4.5/4.7/4.9/4.10 逐条核对（round 1 两处违反已修） | none |
| Module interface design | pass | E/C | seam=validateArtifact/compileTask，deep core，无假 adapter | none |
| Validation and artifacts | pass | E | 四命令 + 交付物清单可从仓库事实反查 | none |

Summary: E=5, C=1, H=0, H-only core checks=none。

## 6. Residual Risk

- TypeBox 对 RunEvent 7 变体 discriminated union 表达力未实证（S2 spike 最早暴露，失败回 roadmap update）
- `@rolekit` npm scope 可注册性（D6 回退 `@rolekit-dev`；epic 批量确认时定案）
- Windows `node --test` + type stripping 兼容性（S1 最早暴露）

## 7. Verdict

- Status: passed
- Next: epic 批量上下文，design 保持 draft，交回 cs-epic 继续下一个子 feature；用户确认延后到全部 child design-review passed 后统一进行

## 8. Focused Closure

- Closed findings: FDR2-001, FDR2-002, FDR2-003, FDR2-004（+ suggestion FDR2-005 采纳）
- Attributed delta: design D7.6/D8/场景 2-3/CMD-001 目的/流程级约束/名词层载荷约定；checklist adapter check、语义负例 check（5 类→4 类）、载荷 check 新增
- Verification: 修订后 checklist 过 validate-yaml.py；D8 集合与 roadmap 4.7"schema 只约束非空字符串"逐字比对一致；fixture 总数与验收路径（真实 CLI）不变
- Classification: 仅修正负例的 layer 归属与文字澄清，未改变行为、公开契约、架构边界、验收范围；reviewer 在 round 2 结论中明确"修完后 focused closure 即可，无需再扩 scope"
