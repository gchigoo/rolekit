---
doc_type: feature-design
feature: 2026-07-24-role-profiles-migration
requirement: ""
roadmap: rolekit-v2
roadmap_item: role-profiles-migration
execution_lane: goal
status: approved
summary: pi-delivery-rolekit 7 角色吸收转换为 7 份 RoleKit RoleProfile YAML + prompt 片段（冻结命名映射：backend+frontend 合并为 implementer、腾出 researcher 席位），7 份全过校验可编译，implementer/reviewer/researcher 各 1 次真实链路 run
tags: [profiles, core, migration, role]
---

# role-profiles-migration design

## 0. 术语约定

| 术语 | 定义 | 防冲突结论 |
|---|---|---|
| 源角色 | pi-delivery-rolekit `extensions/delivery-team/agents/*.md` 的 7 份 agent 定义（frontmatter: name/description/tools + 正文 system prompt） | 只读参考（roadmap owner 原则），不 fork 不依赖 |
| 目标 profile | 4.7 冻结的 RoleProfile YAML（name/capabilities/boundaries/deliverables/verification/prompt_fragments）+ `profiles/` 下 md 片段 | RoleKit 原生产物 |
| 命名映射表 | 源角色名 → 目标 profile 名的冻结对照（D1），语义映射的唯一权威 | 新词，无冲突 |
| 提炼规则 | 源 md 章节 → RoleProfile 字段的转换规则（D3），保证 7 份转换口径一致 | 新词，无冲突 |
| minimal-implementer | pi-rpc-vertical-slice D6 交付的链路验收 fixture | 保留为测试 fixture（`test/fixtures/` 下），与本条 `implementer` profile 不同名不混用 |

RoleProfile / TaskContract / compilePrompt 以 roadmap 4.1 / 4.7 冻结定义为准，不重抄。

## 1. 决策与约束

**需求摘要**：把 pi-delivery-rolekit 的 7 角色吸收转换为 RoleKit 原生 RoleProfile YAML + prompt 片段。做什么：7 份 profile 全部通过 `rolekit validate` 且 `compilePrompt` 可编译出 prompt.md；其中 implementer / reviewer / researcher 3 份各完成 ≥1 次真实链路 run。为谁：后续 research-module（researcher 机制）与所有委派工作流的角色库。明确不做：role_agent 子代理编排语义迁移（编排住 core/lane，Role ≠ Agent——brainstorm 锁定决策）；源仓库 skills（delivery-*）迁移（host-adapter-skills 只读参考过，工作流技能归 CodeStable 替代路线）；prompt 片段的内容重写优化（本条是吸收转换，措辞改良归后续迭代）；ExecutorProfile 扩充（沿用 pi-rpc-vertical-slice 已有）；研究检索能力（归 research-module）。

**复杂度档位**：数据为主（roadmap §3 模块 profiles），深度在 core 编译器（已交付）；本条的设计难点是**语义映射的冻结**与**转换口径的一致性**。

**关键决策**：

- D1 命名映射表（冻结，语义决策——批量确认时 owner 重点过目）：

  | 源角色 | 目标 profile | 理由 |
  |---|---|---|
  | supervisor | coordinator | 编排语义已归 core/lane（Role ≠ Agent），profile 只保留委派协调的角色要求面 |
  | product-analyst | analyst | 直译 |
  | solution-architect | architect | 直译 |
  | backend-engineer + frontend-engineer | implementer（合并） | RoleKit 的 Role = 需求束而非专业分工；前后端专业化片段并入同一 implementer 的 prompt_fragments，实际工作面由 TaskContract 的 objective/scope 收窄；合并腾出第 7 席给 researcher |
  | qa-engineer | qa | 直译 |
  | adversarial-reviewer | reviewer | 对齐 roadmap 验收角色名 |
  | （无直接源）| researcher | 原生新作 profile：以源仓库 delivery-context-recon 技能与 deepsearch讨论.md 的研究工作流为参考素材撰写（只读参考，不计入源角色数），满足验收对 researcher 的要求；检索执行能力归 research-module |

  合计 7 份产物。**映射非 1:1**：源 7 份 agents 中 5 份直转/改名、2 份合并为 1 份（backend+frontend → implementer），共 6 份转换产物；另 1 份为原生新作（researcher）——即"7 源 agents → 5 直转 + 1 合并 = 6 份转换，+ 1 新作 = 7 份"。roadmap "7 角色转 RoleProfile"与"implementer/reviewer/researcher 各 1 run"两个口径同时满足；映射策略同步记入 items.yaml notes 与 MIGRATION.md 供审计。**本表是语义决策，epic 批量确认时作为单列问项请 owner 拍板**（确认时附 7 源 → 7 目标一览，含合并/新作标记）；owner 否决合并方案才升级 roadmap update。
- D2 目录布局：`profiles/roles/<name>.yaml` + `profiles/fragments/<name>/*.md`；`prompt_fragments` 为相对 `profiles/` 的路径（4.7 冻结）；implementer 的 fragments 含 `implementer/core.md` + `implementer/backend.md` + `implementer/frontend.md` 三片段（合并保真，不丢内容）。
- D3 提炼规则（冻结，7 份统一口径，章节名按源文件实际标题——已核实 7 份共有：身份锚定 / Mission / Responsibilities / Non-responsibilities / Inputs / Workflow / SuperClaude 技术行为 / 能力装配 / Output contract / Quality gates / Completion and escalation / Tools and permissions）：
  - `Responsibilities` → `capabilities`（逐条转述）；`Non-responsibilities` → `boundaries`（逐条转述）
  - `Output contract` → `deliverables`；`Quality gates` → `verification`
  - `身份锚定 + Mission` → prompt 片段开头；`Inputs / Workflow / SuperClaude 技术行为 / Completion and escalation` → prompt 片段正文
  - **丢弃**：frontmatter `tools` 与 `Tools and permissions` 章节（工具授权归 executor / 契约，Role ≠ Agent）、frontmatter `model`（归 ExecutorProfile）、`能力装配` 章节（内容为 delivery-* 技能名清单，属源仓库编排配套，与清洁度规则冲突；若含可保留的能力描述则改写为不含技能名的表述，处置逐份记 MIGRATION.md）
  - **编排语义剥离**：任何章节中的编排 / 路由 / lane 选择 / 角色调用链（role_agent 分派）类条目一律丢弃或改写为非编排的边界表述（此语义已归 core/lane，进 Role 即违反 Role ≠ Agent）——supervisor→coordinator 受此规则影响最大，剥离决定逐条记入 MIGRATION.md
  - 个别文件的标题变体按语义等价节匹配，实际对应关系逐份记入 MIGRATION.md
- D4 编译验收口径：对 7 份 profile 各跑 `compilePrompt(profile, task, policy)`（task 用固定 fixture 契约），断言产出含五个**稳定注释锚**且顺序正确：`<!-- rolekit:section:safety -->`、`<!-- rolekit:section:role -->`、`<!-- rolekit:section:task -->`、`<!-- rolekit:section:acceptance -->`、`<!-- rolekit:section:escalation -->`（对应 4.7 五段拼装顺序），进 `npm test`。锚点标记是本条与 compilePrompt 的输出契约：若上游最小实现尚未输出锚点，本条实现期在 core 补充（纯输出标记，不改 4.7 语义），结论回写 compound。
- D5 三角色真实 run 口径：implementer（kind=implementation）/ reviewer（kind=review）/ researcher（kind=research）各 ≥1 次真实链路 run（Pi 真机，pi-rpc-vertical-slice 验收路径复用）。契约模板入库 `profiles/examples/<role>-task.yaml`，dogfood 项目内实例化执行；最低 acceptance 冻结——implementer：真实小实现任务，acceptance 至少 1 条测试或产物断言命令（exit 0）；reviewer：deliverable = writable scope 内的 `docs/review-report.md`，acceptance = 存在性 + 非空断言命令；researcher：deliverable = `docs/research-notes.md`，acceptance = 存在性 + 非空断言命令。成功判据 = run 完成且五件产物全过 `rolekit validate`。**researcher run 有且仅有以上断言**——明确无 citation / activity.json / 检索调用要求（research-module 的验收边界），只验证 profile 可驱动 kind=research 契约走完链路。
- D6 转换报告：`profiles/MIGRATION.md` 记录映射表应用结果——每份产物的源文件、章节→字段提炼对照（含标题变体的实际匹配）、丢弃项（tools/model/Tools and permissions/编排语义条目及理由）、implementer 的 backend vs frontend 冲突条款显式对照表、researcher 的参考素材清单；供 code review 语义保真抽检。
- D6a 目录消费关系：`profiles/` 是**库产物**（RoleKit 仓库内维护的角色库）；项目运行时消费走 4.8 的 `.rolekit/profiles/`——dogfood / run 验收时经复制（或 rolekit.yaml 配置引用，实现期从简用复制）落到目标项目。
- D7 源仓库处置：pi-delivery-rolekit 全程只读；归档时机由 owner 在本条 acceptance 后决定（roadmap notes），本条不做归档动作。

**基线风险**：实现/run 验收前置 pi-rpc-vertical-slice 严格 done（compilePrompt 与 run 链路）；design 先行合规（epic 批量 admission）。

**Top 3 风险与缓解**：
1. 合并 implementer 的语义保真（backend/frontend 边界条款可能互相冲突）→ D2 三片段结构保留原文分区 + D6 报告抽检；冲突条款在片段内按源标注归属
2. researcher 无直接源、原生撰写质量 → 参考素材冻结（delivery-context-recon + deepsearch讨论.md）+ 真实 run 验收兜底；不追求完备，research-module 会迭代
3. 源 md 是中文混排、章节命名不完全一致 → D3 规则按语义章节而非字面标题匹配，转换报告逐份记录实际对应关系

**非显然依赖**：pi-rpc-vertical-slice 的 compilePrompt 与 run 命令面（严格 done 前置）；contract-schemas 的 RoleProfile schema 与 validate；Pi 真机环境（三 run 验收）；源仓库 `extensions/delivery-team/agents/*.md` 现状（已核实 7 份存在）。

**关键假设**：4.7 的 RoleProfile 字段足以承载源角色的结构化要求（Responsibilities/Non-responsibilities 等章节可无损映射到 capabilities/boundaries）；若字段不够用（发现需新增字段），走 roadmap update 而非私自扩 schema。

**必跑验证命令**：`npm run validate:profiles`（包装 `rolekit validate profiles/roles/*.yaml`，7 份全过）、`npm test`（编译五锚点断言 + fragments 路径解析断言）、`npx tsc --noEmit`、`npx biome check .`、三角色真实 run 的五件产物 validate；全部 Windows 本机。

**交付物清单**：`profiles/roles/` 7 份 YAML、`profiles/fragments/` 片段集、`profiles/examples/` 三份契约模板、`profiles/MIGRATION.md` 转换报告、编译锚点与路径解析单测、package.json 增 `validate:profiles`、三角色真实 run 证据（run 目录）、items.yaml 回写。

**清洁度规则**：禁止 fragments 中残留源仓库专有引用（role_agent / agentScope / delivery-* 技能名——lint grep 断言；MIGRATION.md 作为参考素材记录不受此限，禁的是宿主可见的 fragments 产物）；禁止 TODO/FIXME；profile YAML 不携带 schema 未定义字段（validate 兜底）。

## 2. 名词与编排

### 2.1 名词层

**现状**：core 已有 RoleProfile schema + compilePrompt + minimal-implementer 测试 fixture；`profiles/` 目录无现状，全新。

**变化**（全部新增，schema 不动）：

- `profiles/roles/{coordinator,analyst,architect,implementer,qa,reviewer,researcher}.yaml`：7 份 RoleProfile
- `profiles/fragments/<name>/*.md`：prompt 片段（implementer 三片段，其余各 ≥1）
- `profiles/examples/{implementer,reviewer,researcher}-task.yaml`：三份契约模板（D5）
- `profiles/MIGRATION.md`：转换报告（D6）
- `packages/core` 测试新增：7 份 profile 的编译五段锚点断言 + prompt_fragments 路径解析断言（片段文件缺失 → 编译报错的负例）

**Interface 设计检查**：本条无新接口——消费 core 的 compilePrompt seam 与 validate；profiles 是数据。minimal-implementer fixture 与 implementer profile 隔离（fixture 在 test/ 下，不进 profiles/）。

### 2.2 编排层

**现状**：无新增运行时编排。

**变化**：转换为线性数据流程，不画图：`源 agents/*.md →（D1 映射 + D3 提炼规则，人工转换）→ profiles YAML + fragments → rolekit validate + 编译断言 → 三角色真实 run`。

**流程级约束**：转换是一次性人工工作（非脚本自动转换——7 份体量小，语义提炼需要判断；migrate-tool 的自动化针对 .codestable 遗产，与本条无关）；每份转换完成即跑 validate + 编译断言，不积压；三 run 使用的契约必须真实（不造假任务），且 researcher run 的验收边界按 D5 冻结。

### 2.3 挂载点清单

1. `profiles/` 目录加入 workspace 检查范围（biome / validate CI 步骤）— 新增
2. CI 命令矩阵追加 `npm run validate:profiles`（统一脚本名）— 修改
3. core 测试套件新增编译断言文件 — 新增
4. roadmap items.yaml 状态回写 — 修改

### 2.4 推进策略

1. 冻结落地：profiles/ 骨架 + 编译五锚点契约确认（上游未输出锚点则在 core 补充，D4）+ implementer 一份先行转换（含三片段合并）→ 退出信号：implementer 过 validate + 编译五锚点断言绿（spike 最难的合并场景）
2. 其余 5 份源转换（coordinator/analyst/architect/qa/reviewer，coordinator 按 D3 编排剥离规则）→ 退出信号：6 份全过 validate + 编译断言，fragments 路径解析负例断言绿
3. researcher 原生撰写（参考素材冻结口径）+ examples 三份契约模板 → 退出信号：7 份全过 validate + 编译断言，模板过 rolekit validate
4. MIGRATION.md 转换报告 + 清洁度 lint（源专有引用 grep）→ 退出信号：报告覆盖 7 份且 grep 零命中
5. implementer 真实 run → 退出信号：run 完成、五件产物全过 validate
6. reviewer + researcher 真实 run → 退出信号：两 run 同口径完成（researcher 按 D5 边界）
7. 收口：证据归档 + items.yaml 回写 → 退出信号：Goal Coverage Matrix 行"7 profile 全过校验可编译；3 角色各 ≥1 次真实 run"证据齐全

### 2.5 结构健康度与微重构

##### 评估
- 文件级——被改文件仅 CI 配置与 core 测试目录：改动点 ≤2 处
- 目录级——profiles/ 按 roles/fragments 分层，每角色一子目录，无摊平

##### 结论：不做

##### 超出范围的观察
- 源仓库 skills（delivery-*）含可复用方法论素材，未来 knowledge-layer 或可吸收为 KnowledgeEntry——不属本条

## 3. 验收契约

关键场景清单：

1. 7 份 profile 全过 `rolekit validate`（CI 步骤）
2. 7 份 profile 各过编译五锚点断言（`<!-- rolekit:section:safety|role|task|acceptance|escalation -->` 存在且顺序正确，D4）
3. fragments 路径解析负例：prompt_fragments 指向不存在文件 → compilePrompt 报错（不静默）
4. implementer 真实 run（kind=implementation，examples 模板实例化）：acceptance ≥1 条断言命令 exit 0，run 完成 + 五件产物全过 validate
5. reviewer 真实 run（kind=review）：deliverable `docs/review-report.md` 存在性 + 非空断言过，同口径
6. researcher 真实 run（kind=research）：deliverable `docs/research-notes.md` 存在性 + 非空断言过，且明确无 citation / activity.json / 检索断言（research-module 边界，D5）
7. 清洁度 grep：fragments 无 role_agent / agentScope / delivery-* 源专有引用
8. MIGRATION.md 覆盖 7 份产物：源文件、章节→字段对照（含变体匹配）、丢弃项与编排剥离记录、implementer 冲突条款对照表、researcher 参考素材清单

明确不做的反向核对项：无 role_agent 编排代码或语义迁移；无 delivery-* skills 文件迁移；无 schema 字段新增（core diff 零 schema 变更）；minimal-implementer fixture 未被移动或改名。

### 3.x Acceptance Coverage Matrix

| Scenario | Covered By Step | Evidence Type | Command / Action | Core? |
|---|---|---|---|---|
| 7 份 validate 全过（S3 收齐，S1/S2 增量） | S3 | command | `npm run validate:profiles`（CI） | yes |
| 7 份编译五锚点断言（S3 收齐） | S3 | test | `npm test` | yes |
| fragments 路径解析负例 | S2 | test | `npm test` | yes |
| implementer 真实 run | S5 | run artifacts | Pi 真机 run + validate | yes |
| reviewer 真实 run | S6 | run artifacts | 同上 | yes |
| researcher 真实 run（D5 边界） | S6 | run artifacts | 同上 | yes |
| 清洁度 grep 零命中 | S4 | command | lint grep | yes |
| MIGRATION.md 完整性 | S4 | diff review | 报告覆盖 7 份 | no |
| 明确不做反向核对 | S7 | diff review | grep + core diff | no |

### 3.y DoD Contract

| ID | 要求 | 证据 | 阻塞级别 |
|---|---|---|---|
| DOD-DESIGN-001 | design 完整且映射表/提炼规则冻结 | design review | blocking |
| DOD-IMPL-001 | checklist steps 全完成且证据落盘 | checklist / evidence | blocking |
| DOD-REVIEW-001 | code review passed（含语义保真抽检）无 unresolved blocking | review report | blocking |
| DOD-QA-001 | QA 覆盖 7 份校验编译与 3 真实 run | QA report | blocking |
| DOD-ACCEPT-001 | acceptance 回写与审计完成 | acceptance report | blocking |

Validation Commands:

| ID | 命令 | 目的 | 核心性 | 失败处理 |
|---|---|---|---|---|
| CMD-001 | `npm run validate:profiles` | 7 份 schema 校验 | core | fix-or-block |
| CMD-002 | `npm test` | 编译五锚点断言 + 路径解析负例 | core | fix-or-block |
| CMD-003 | `npx tsc --noEmit` / `npx biome check .` | 类型与 lint | core | fix-or-block |
| CMD-004 | `rolekit validate <run 产物>` | 三 run 五件产物校验 | core | fix-or-block |

Required Artifacts: review / QA / acceptance 报告、7 份 profile + fragments、`profiles/examples/` 三份契约模板、MIGRATION.md、三角色 run 目录、清洁度 grep 输出。

## 4. 与项目级架构文档的关系

- 名词：命名映射表 / 提炼规则 → acceptance 时把 7 角色名提炼进 `requirements/CONTEXT.md`（Role 词条的实例集）
- 动词骨架：无新增编排；D1 合并映射是语义决策——批量确认时 owner 过目，若 owner 否决合并方案则回本 design 修订（不需 ADR，roadmap 条目语义未变：仍是"7 份 + 3 角色 run"）
- 4.7 字段承载力实证结论（够用/不够用）与 researcher 原生撰写经验 → compound（知识回写点）
