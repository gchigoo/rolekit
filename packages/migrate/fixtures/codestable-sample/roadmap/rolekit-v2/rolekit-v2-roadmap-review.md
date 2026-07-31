---
doc_type: roadmap-review
roadmap: rolekit-v2
status: passed
review_state: passed
review_reason: ""
reviewer_id: "936de3db-6825-485e-b2de-c93189548797"
reviewed: 2026-07-24
round: 6
---

# rolekit-v2 roadmap 审查报告

## 1. Scope And Inputs

- Roadmap: .codestable/roadmap/rolekit-v2/rolekit-v2-roadmap.md
- Items: .codestable/roadmap/rolekit-v2/rolekit-v2-items.yaml
- Related docs: brainstorms/rolekit-v2-direction/brainstorm.md、requirements/CONTEXT.md、requirements/adrs/001-006、讨论.md、deepsearch讨论.md
- Code facts checked: D:\Personal\skeg\package.json（exports/engines/peerDependencies）、D:\Personal\pi-delivery-rolekit（extensions/skills 结构）、D:\Personal\pi-web-fetch（README/工具面）、全盘 deep-research 源码检索（未找到；后经 owner 修订不再需要）

### Independent Review

- Status: completed
- Detection: heterogeneous-agent（主线 Claude 家族，reviewer GPT 家族）
- Provider / agent: Task agent c236d8ee-9a16-49bd-88c2-f7e94ca44d88（round 1-5）、936de3db-6825-485e-b2de-c93189548797（round 6，owner 修订后聚焦复审 + 闭合确认）
- Raw output: round 1-6 findings 全文见各轮回传（RMR-001..016、R2-001..012、R3-001..009、R4-001..007、R6-001..007）
- Merge policy: 每轮逐条本地核验（含 skeg package.json、deep-research 检索、文档交叉比对）后合并；无照抄
- Gate effect: round 1-3 各存 blocking，均回 planning 修订后重审；round 4 无 blocking、important 按修复边界处理；round 5 确认关闭；round 6 审 owner 修订（verifier-gate-engine / research-module 更名重定义），R6-001 blocking + R6-002..004 important + R6-005 nit 修订后闭合，closure 复核另出 R6-006/007（记录一致性与 adapter 注册表归属）随即修订
- Read-only 核验: 每轮前后 .codestable 校验和对比，reviewer 零写入（VerifiedNoWrite）

## 2. Roadmap Summary

- Goal completion signal: 9 个 core 信号全部量化（fixture 判定、连续 run 计数、完整率机械定义、迁移零 skip 判据、自举台账）
- Module split: 7 模块（core/runner/cli/migrate/adapters/profiles/evals），职责单句清晰，CLI 刻意 shallow 有 rationale
- Interface contracts: 4.1-4.10 共 9 类 schema + ExecutorAdapter/Verifier 两个 seam，写到字段/签名/exit code/状态转移表级
- Items: 11 条，minimal_loop = pi-rpc-vertical-slice（四阶段验收），收口条目覆盖硬化/回归/自举/切换
- Dependency shape: DAG 无环，每条边标注消费产物理由

## 3. Findings

### blocking

- [x] RMR-001..005（round 1）：完成信号不可证伪 / 协议不足以硬约束 / WorkItem 契约缺失 / 越界机制缺失 / veritack API 假设错误——均已修订（变更日志 round 1）
- [x] R2-001..004（round 2）：migrate 全 skip 绕过 / 幂等键缺输入 / gate 状态机不闭合 / worktree "物理不可达"过度承诺——均已修订（变更日志 round 2）
- [x] R3-001..003（round 3）：goal kind 缺失 / KnowledgeEntry 协议未冻结 / roadmap item 与 feature 重复建项——均已修订（变更日志 round 3）
- [x] R6-001（round 6）：research-module 与冻结契约衔接未闭合（adapter 枚举 / RunEvent 映射 / citation-evidence 绑定）——按"不新增 schema"方案修订：adapter 改注册表校验、进度复用既有事件类型、产物固定 report.md + activity.json 且 evidence 仅存路径（变更日志 round 6）

### important

- [x] RMR-006..010、R2-005..008、R3-004..006、R4-001..004——均按修复边界修订并经 round 4/5 确认关闭
- [x] R6-002..004（round 6）：research 验收断言化 / 审批与审查报告旧口径 / ADR 003-006 措辞冲突——已修订并经 closure 复核确认
- [x] R6-006/007（round 6 closure）：本报告元数据升 round 6 并补 closure 记录；adapter 注册表归属明确为 runner 所有、CLI 仅透传 unknown_adapter 错误——本条即其修订

### nit

- [x] R2-009 / R4-004 schema 口径——已统一为 9 类
- [x] R6-005 veritack 原语计数——全文统一为 Run/Context/Check/Gate/Record 五原语

### suggestion

- [x] RMR-011 垂直链路阶段化验收——已采纳（四阶段验收点）

### learning

- veritack 的扩展方向是"第三方向它提供 provider"而非"调用它的 core"；该事实促成 owner 拍板"吸收 + 改良、不集成"（ADR 006），原四选一 design gate 取消，改为吸收清单设计产物

### praise

- 范围边界与"明确不做"具体（MCP/多 writer/sandbox 显式排除）；最小闭环放最大未知（Pi RPC）上，避免重蹈 sdk-first
- 外部资产描述与仓库事实一致（7 角色、11 skills、@veritack/pi-veritack@1.3.1、dogfood 存在）

## 4. User Review Focus

- 用户需要重点拍板：11 条拆解与依赖顺序是否符合优先级；goal kind 与 KnowledgeEntry 四类的建模是否接受；migrate 必迁类别与去重规则是否符合迁移意图
- 后续 feature-design 需要重点复核：Pi RPC Windows 稳定性（timebox + SDK fallback 触发条件）；verifier-gate-engine 吸收清单（item 5 design 产物，方向已定 ADR 006）；research-module 执行路线拍板（item 6 design，评审框架见 roadmap 观察项）；CodeStable 机制盘点清单（item 8 design gate）
- 不能靠 roadmap review 完全确认的点：见 Residual Risk

## 5. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Granularity Gate | pass | E | roadmap#2 表格 + 11 条跨模块 DAG 事实 | none |
| Goal Coverage Matrix | pass | E | 12 行矩阵，9 core 全有 item/入口/证据类型 | none |
| DAG and minimal loop | pass | E | items.yaml 解析无环；minimal_loop 唯一 | none |
| Interface contract usability | pass | E/C | 4.1-4.10 字段级契约；veritack exports 经 package.json 核验 | item 5 吸收清单（方向已定 ADR 006） |
| Module interface depth | pass | E/H | 两 seam 各两 adapter 非假 seam；CLI shallow 有 rationale | design 阶段防逻辑漏进 CLI |

Summary: E=4, C=1, H=1（depth 判断部分依赖工程判断），H-only core checks=none。

## 6. Residual Risk

- Pi RPC Windows 长任务稳定性未实证（R4-006/RMR-015）：垂直链路 design 设 timebox 与 SDK adapter fallback
- network deny 非硬隔离（R4-007）：声明 + 事后审计，不得宣称网络阻断；真 sandbox 后置
- 主区基线检查只检测不归因（R4-005）：并发人工修改会触发 fail-safe 误失败，运行说明需提示
- research-module 外部服务依赖（owner review 后新增）：openai-responses 路线依赖 OPENAI_API_KEY 与账户模型权限，Pi 会话路线依赖 web 检索层——design 阶段按 roadmap 观察项框架拍板
- superpowers 包结构与许可未盘点（RMR-016）：item 10 design 阶段处理

## 7. Verdict

- Status: passed
- Next: 交给用户 review（ConfirmRoadmap checkpoint）
