---
doc_type: feature-design-review
feature: 2026-07-24-host-adapter-skills
status: passed
review_state: passed
review_reason: ""
reviewer_id: "7f13e6fd-9263-48bb-99ac-22f0bbefebcd"
reviewed: 2026-07-24
round: 4
---

# host-adapter-skills feature design 审查报告

## 1. Scope And Inputs

- Design: .codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-design.md
- Checklist: .codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-checklist.yaml
- Intent / brainstorm: none（epic 批量 design，输入为 roadmap 条目 3）
- Roadmap: .codestable/roadmap/rolekit-v2/（§3 模块 adapters + §4.5 + §5 条目 3 + Goal Coverage Matrix）
- Related docs: adrs/001（Skill 不承载工作流语义）、pi-rpc-vertical-slice design（命令面与五件产物基线）
- Code facts checked: greenfield（adapters/ 无源码）；pi-delivery-rolekit skills 形态只读核实（SKILL.md + frontmatter）

### Independent Review

- Status: completed
- Detection: heterogeneous-agent（主线 Claude 家族，reviewer Grok 4.5 High——owner 指定）
- Provider / agent: Task agent 7f13e6fd-9263-48bb-99ac-22f0bbefebcd
- Raw output: round 1 FDR-001..012、round 2 完整复审（原 12 条闭合 + FDR2-001..006）、round 3 focused closure（余 FDR2-004）、round 4 最终核对 passed
- Merge policy: 每条经主 agent 本地核验（roadmap §4.5 / Goal Matrix / ADR 001 原文比对）后合并；无照抄
- Gate effect: round 1 changes-requested（1 blocking）；round 2 确认原 finding 全闭合但新增 3 important；round 3/4 focused closure 逐条闭合，verdict passed

## 2. Design Summary

- Goal: pi / codex / cursor 三份薄 Skill 入口，教宿主驱动 `rolekit` CLI（4.5 冻结命令面）；验收锚定 pi + cursor 两宿主各 ≥1 次经 Skill 驱动的委派 run
- Key contracts: D3 薄度守护四断言（正选模式 + flag 白名单 / ≤200 行 / 冻结禁词表词界匹配 / 零 diff）；D4 command-map 单一事实源 + build 生成 + 规划中不进产物；D5 委派判据三件套（产物 validate + check:delegation 机械裁定 + skill 版本绑定操作约束）；D6 可用区冻结枚举 + 默认教 --json；codex 交付不计验收（D2）
- Steps: 5（S1 骨架与守护、S2 pi 委派、S3 cursor 委派、S4 codex 交付、S5 收口）
- Checks: 12，来源字段齐全
- Baseline / validation: 实现/验收前置 pi-rpc-vertical-slice 严格 done；design 先行合规（epic 批量 admission）

## 3. Findings

### blocking

- [x] FDR-001 "经 Skill 驱动"缺可证伪判据且与 Goal Matrix skill diff 证据口径不对齐——已修：D5 三件套 + check-delegated-run.mjs 机械裁定 + skill sha256/git rev 归档，场景/Matrix/Required Artifacts/CMD-004 全同步

### important

- [x] FDR-002 薄度守护可绕过（非 rolekit 调用形态、禁词表示例化）——已修：正选模式 + 禁调用形态 + 禁词表 11 词冻结 + 约束对象钉死
- [x] FDR-003 规划中区是否进宿主产物未钉死——已修：D4 只拼可用区，lint 断言产物无规划中命令
- [x] FDR-004 升级路径 Core?=no 削弱 ADR 001 行为验收——已修：Core?=yes，判据并入 check:delegation + 人工复核
- [x] FDR-005 execution_lane 误标 standard——已修：goal（epic child 一致）
- [x] FDR-006 可用命令与上游真实能力未对齐（steer 等）——已修：D6 冻结可用区枚举，steer/workitem/migrate 入规划中并标注归属
- [x] FDR2-001 CI 未纳 check:delegation fixture 回归——已修：fixture 断言以单测进 npm test（CI 既有命令）
- [x] FDR2-002 skill hash 与会话版本绑定机械路径未钉死——已修：D5(3) 方案 B（install-skill 后立即委派 + 期间不改 adapters/ + 归档 git rev + sha256）
- [x] FDR2-003 正选模式未冻结合法 flag——已修：flag 白名单（全局 --json；run start 另允 --detach），lint 与 check:delegation 同一口径

### nit

- [x] FDR-007 S1 可用区未写全 task create——已修
- [x] FDR-008 挂载点 check 措辞与 2.3 对齐——已修
- [x] FDR-009 200 行口径未钉——已修：生成后全文含 frontmatter 与空行
- [x] FDR-010 codex 核实日期落 README——已修：D7 + S4 exit
- [x] FDR2-004 S1 负例数量与场景 8 不一致——已修：统一 1 正 + 2 负
- [x] FDR2-005 裸词 lane 误伤风险——已修：词界匹配
- [x] FDR2-006 DOD-QA-001 未点名 CMD-004——已修

### suggestion

- [x] FDR-011 可用区默认教 --json——已采纳（D6）
- [ ] FDR-012 禁条件分支句式的人工检查单——未采纳为机械断言，留 code review 抽检（残余风险注明）

### learning

- 文档型交付物的验收同样需要机械判据：会话证据 + 命令白名单 + 版本绑定三层，"经 Skill 驱动"才可证伪
- 刻意 shallow 的模块，design 的重心在守护断言的封闭性（正选模式 + flag 白名单）而非接口深度

### praise

- D2 codex 交付不计验收（不假承诺）；D4 单一事实源 + 生成物入库 + 零 diff 防漂移扎实；依赖口径正确区分 design admission 与实现严格 done

## 4. User Review Focus

- 用户需要重点拍板（epic 批量确认时）：验收宿主选取 pi + cursor（codex 不计验收）；≤200 行与禁词表初值
- implement 需要重点遵守：Skill 只含 D3 四类内容；产物必须 build 生成；可用区/flag 白名单封闭；委派验收走 D5 三件套规程
- code review / QA / acceptance 需要重点复核：语义泄漏人工抽检（FDR-012）；两宿主会话记录复核；codex 落位核实记录

## 5. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Acceptance Coverage Matrix | pass | E | 7 行矩阵，两宿主三件套 + 守护断言 + fixture 可证伪全有 | none |
| DoD Contract | pass | E | 5 DoD + 4 CMD，与 checklist dod.commands 一致 | none |
| Steps and checks traceability | pass | E | 5 steps 退出信号可判定；12 checks 均可回溯 design | none |
| Roadmap contract compliance | pass | E | §5 条目 3 / Goal Matrix skill diff / 4.5 不新增命令逐条核对 | none |
| ADR 001 机械守护 | pass | E | 正选模式 + flag 白名单 + 禁词 + 零 diff 封闭 | 语义泄漏 review 抽检 |
| Validation and artifacts | pass | E | lint:adapters + check:delegation + validate，Windows 本机 | none |

Summary: E=6, C=0, H=0, H-only core checks=none。

## 6. Residual Risk

- 宿主是否选中 Skill 依赖 description 措辞（验收即触发测试，失败先修措辞不加逻辑）
- 行数/禁词是薄度代理，无法穷尽语义泄漏（code review 人工抽检兜底）
- Codex 入口格式漂移（已排除验收；核实记录含日期）
- 宿主会话导出格式解析口径实现期钉（check:delegation 支持 Pi / Cursor 两种导出）

## 7. Verdict

- Status: passed
- Next: epic 批量上下文，design 保持 draft，交回 cs-epic 继续下一个子 feature；用户确认延后到全部 child design-review passed 后统一进行

## 8. Focused Closure

- Closed findings: FDR2-001..006（round 3）+ FDR2-004 残留一行与 2.1 nit（round 4）
- Attributed delta: D3(a) flag 白名单与词界匹配；D5(3) 版本绑定方案 B；挂载点 3 CI 口径；场景 8 / Matrix / DOD-QA-001；design 2.4§1 与 2.1 措辞
- Verification: 修订后 checklist 过 validate-yaml.py；委派三件套语义未变；flag 白名单与 4.5 命令面（--json/--detach）逐字比对一致
- Classification: 均为守护断言口径补全与文字对齐，未改变验收范围与架构边界；reviewer round 2 verdict 明确允许该范围走 focused closure
