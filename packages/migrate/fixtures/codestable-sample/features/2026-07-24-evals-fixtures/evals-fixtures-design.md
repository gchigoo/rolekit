---
doc_type: feature-design
feature: 2026-07-24-evals-fixtures
requirement: ""
roadmap: rolekit-v2
roadmap_item: evals-fixtures
execution_lane: goal
status: approved
summary: 三指标（契约完整率/写入越界检出/Envelope 完整率）机械评测——种子取自垂直链路真实 run 产物（脱敏冻结快照），纯离线重放判定函数，npm run evals 一键回归带阈值 exit 语义
tags: [evals, fixtures, regression]
---

# evals-fixtures design

## 0. 术语约定

| 术语 | 定义 | 防冲突结论 |
|---|---|---|
| seed（种子）| 从真实 run 产物脱敏复制的冻结快照目录（`evals/seeds/<name>/`），evals 的输入台账 | 新词，无冲突；与单测 fixture 区分——seed 来自真实链路，fixture 为手工构造 |
| 指标（metric）| 对 seed 台账逐 run 计算的机械公式（D1 冻结三项），输出比例 + 逐 run 明细 | 新词，无冲突 |
| 离线重放 | 以落盘产物为唯一输入重新执行纯判定函数（validate / 语义规则 / 路径存在性），不启动任何 executor | 与 verifier-gate-engine 改良3"可离线重放"同一语义 |
| evals 报告 | `npm run evals` 输出的 JSON（逐指标逐 run 明细 + 汇总 + verdict）| 新词，无冲突；非 core schema（评测产物，结构由 evals 包自持）|

ResultEnvelope / TaskContract / VerificationReport 以 roadmap 4.1/4.6 冻结定义为准，不重抄。

## 1. 决策与约束

**需求摘要**：契约完整率 / 写入越界率 / Envelope 完整率三类机械评测 fixture，`npm run evals` 一键回归，种子场景取自垂直链路验收 run 的真实产物（roadmap 条目 7）。为谁：hardening-dogfood-switchover 的"Envelope 完整率 100%"验收复用同一机械定义；回归防护（schema / verifier / runner 改动不破坏既有 run 语义）。成功标准：`npm run evals` 对种子台账一键回归绿；负例 seed 能翻红并 exit 1（指标可失败性证明）。明确不做：新增 core schema（evals 报告结构由 evals 包自持）；启动真实 executor 或网络调用（纯离线）；替代单测（单测归各包，evals 只做台账级指标回归）；评测 UI / 历史趋势存储（一次性输出，趋势归后续）；LLM 评审类 eval（全部机械判定）；research-module 四断言复用（check:research 已独立交付，evals 不重复包装）。

**复杂度档位**：数据 + 纯函数为主；设计难点是**指标公式的机械冻结**与**种子的可信来源链**。

**关键决策**：

- D1 三指标机械公式冻结（对 seed 台账逐 run 计算，输入 = run 目录产物，纯函数）：
  - **契约完整率** = 台账内 `task.json` 通过 `validateArtifact`（结构 + 语义）的 run 数 / 台账 run 总数。阈值 100%。
  - **写入越界检出** = 两个子指标：(a) 检出率 = 注入类 seed（预期含违规）中 `verification.json.scope_violations` 非空的数 / 注入类 seed 总数，阈值 100%；(b) 误报数 = 合规类 seed 中 `scope_violations` 非空的数，阈值 0。seed 的预期标签（注入/合规）由 seed 元数据声明（D2），非运行时推断。
  - **Envelope 完整率** = 台账内同时满足三条的 run 数 / 台账 run 总数，阈值 100%：(i)+(ii) = 对 `result.json` 调用 core 的 `validateArtifact`（结构 + 语义两层——语义规则即 contract-schemas D7.2 的两条：非 completed 则 unresolved 非空、scope_violations 非空则 status 非 completed；**单一实现在 core，evals 不手写第二份**）；(iii) = evidence 相对路径在 run 目录内全部存在（validateArtifact 之外的 evals 补充判定，需文件系统）。与 roadmap 条目 11 的机械定义逐字对齐。
  - **指标读取源钉死**：越界双子指标只读 `verification.json.scope_violations`；Envelope 指标只读 `result.json`（经 validateArtifact）。两文件不做交叉比对——一致性由 pi-rpc 的 Envelope 组装所有权（runner 单点组装）保证，evals 不重复裁定。
  - **调用面冻结（hardening 条目 11 复用契约）**：`evaluateRun(runDir, meta?) -> RunEvalResult`——`meta.expectation` 可选，**仅越界双子指标依赖它**（无 meta 时越界指标输出 `skipped`，契约与 Envelope 两指标照算）。hardening 台账（真实 run 无 expectation）以无 meta 模式调用，得到契约完整率 + Envelope 完整率——**单一事实源，两条目不各写一份公式**。`RunEvalResult` 形状冻结：`{ contract: 'pass'|'fail', envelope: { validate: 'pass'|'fail', evidence_paths: 'pass'|'fail', pass: boolean }, scope: { detected: boolean } | 'skipped' }`——`envelope.pass ≡ validate 与 evidence_paths 皆 pass`（合取，写入形状断言）；`scope = 'skipped'` 当且仅当无 meta **或** `expectation = 'cancelled'`（与 D3"cancelled 不计入越界两子指标"一致），仅 `clean` / `violation` 产出 `{ detected }`。
- D2 种子来源链与目录契约：`evals/seeds/<seed-name>/`，每个 seed = 真实 run 目录的脱敏复制（五件产物齐全）+ `seed.yaml` 元数据（`{ name, source: <run-id 与来源条目>, expectation: 'clean' | 'violation' | 'cancelled', captured: date }`）。首批种子冻结取自 pi-rpc-vertical-slice 验收产物：dogfood 2 次成功 run（clean）、1 次 cancel run（cancelled）、越界注入 run（violation）、主区注入 run（violation）——**≥5 个 seed**。脱敏规则：绝对路径改相对、剔除 env / key / 用户名字样（grep 断言进 evals 自检）；采集脚本 `npm run evals:capture -- <runDir> <name> <expectation>` 机械执行复制 + 脱敏 + 元数据生成（防手工漂移）。**入库准入门闩**：capture 最后一步对新 seed 跑 `evaluateRun`，契约与 Envelope 指标必须 pass；越界判据按 expectation 分派——`clean` 断言 `detected=false`、`violation` 断言 `detected=true`、`cancelled` 不验越界（scope='skipped'，只验契约 + Envelope）。不达预期则拒绝入库 exit 1（稳定码 `seed_rejected`，报告指明是上游产物缺陷而非 evals 问题）——防真实种子一入库台账永红且难归因。
- D3 expectation 语义：`clean` → 计入三指标全部分母，越界误报子指标断言 scope_violations 为空；`violation` → 计入契约/Envelope 分母 + 越界检出分子分母；`cancelled` → 计入契约/Envelope 分母（Envelope 语义规则对 cancelled 的 unresolved 非空同样成立），不计入越界两子指标。expectation 集合封闭为三值，未知值 → evals 直接 exit 1（`unknown_expectation`）。
- D4 一键回归与 exit 语义：`npm run evals` = 遍历 `evals/seeds/` 全部 seed → 三指标计算 → stdout JSON 报告（逐 run 明细 + 汇总 + `verdict: pass|fail`）。exit 0 = 全指标达阈值；exit 1 = 任一指标未达阈值或 seed 元数据非法；exit 2 = 用法错误（对齐 4.5 约定）。报告为机器可读 JSON（`--summary` 附人读摘要），不落盘历史。
- D5 可失败性证明（防"永远绿"的假回归）：`evals/seeds-negative/` 独立目录放 ≥4 个损坏 seed（Envelope 缺 unresolved 的 failed run / task.json 缺必填字段 / violation seed 的 scope_violations 被清空 / evidence 引用不存在路径——四类各对应一个指标分项），`npm test` 内断言对负目录跑 evals 引擎必产出 fail verdict——负例不进日常 `npm run evals` 台账，作为引擎自身的单测 fixture。
- D6 CI 接入：`npm run evals` 进 CI 命令矩阵（contract-schemas 建立的矩阵追加一行）；seed 是仓库内冻结快照，CI 无需真实链路——真实链路的新 run 采集属 hardening 台账扩容，不在本条。

**基线风险**：实现前置 pi-rpc-vertical-slice 严格 done（种子来源）；design 先行合规（epic 批量 admission）。种子在上游验收完成前无法采集——S1 先以 mock 链路产物做引擎开发种子（标注 `source: mock`，上游 done 后由真实种子替换并保留 mock 种子作单测 fixture）。

**Top 3 风险与缓解**：
1. 种子脱敏遗漏（路径/用户名泄漏进仓库）→ D2 采集脚本机械脱敏 + evals 自检 grep 断言（api key / 盘符绝对路径 / 用户名模式）
2. 指标公式与 hardening 条目 11 定义漂移 → D1 单一事实源（同一 `evaluateRun` 函数），设计期已逐字对齐条目 11 机械定义
3. 假回归（台账全绿因为断言太弱）→ D5 负例 seed 强制可失败性证明进 `npm test`

**非显然依赖**：pi-rpc-vertical-slice 验收 run 产物（首批真实种子）；contract-schemas 的 validateArtifact（指标 (i) 复用）；无网络 / 无 executor / 无 OPENAI 依赖（纯离线）。

**关键假设**：五件产物 + seed.yaml 足以支撑三指标全部输入（验证于 S1 mock 种子；不足则回本 design 修订——预期充分，因指标全部定义在落盘产物上）。

**必跑验证命令**：`npm test`（指标纯函数单测 + D5 可失败性断言 + 脱敏自检单测）、`npm run evals`（种子台账回归）、`npx tsc --noEmit && npx biome check .`；全部 Windows 本机。

**交付物清单**：`packages/evals/`（evaluateRun 纯函数 + 台账遍历 + 报告输出）、`evals/seeds/`（首批 ≥5 真实种子）与 `evals/seeds-negative/`（≥4 损坏种子）、`npm run evals` / `npm run evals:capture` scripts、CI 矩阵追加、items.yaml 回写。

**清洁度规则**：seed 内禁止绝对路径 / key / 用户名（自检断言）；evaluateRun 无 IO 之外的副作用（只读 run 目录）；禁止调试输出；TODO/FIXME 禁止落盘。

## 2. 名词与编排

### 2.1 名词层

**现状**：evals 模块为 roadmap §3 规划的空模块；core 有 validateArtifact；runner 验收 run 产物结构已由 pi-rpc 冻结。

**变化**：

- `packages/evals/src/evaluate.ts`：`evaluateRun(runDir, meta?) -> RunEvalResult`（meta 可选，见 D1 调用面冻结）、`evaluateLedger(seedsDir) -> EvalsReport`（纯函数 + 只读 IO 分离：目录遍历在 CLI 层）
- `packages/evals/src/capture.ts`：采集脚本实现（复制 + 脱敏 + seed.yaml 生成）
- `evals/seeds/<name>/{task.json,prompt.md,events.jsonl,result.json,verification.json,seed.yaml}`：种子目录契约
- `evals/seeds-negative/`：损坏种子（引擎单测专用）

接口示例（失败与边界路径）：

```ts
// expectation 未知值 -> 整体 exit 1，不猜
evaluateLedger('evals/seeds')  // seed.yaml expectation: 'weird' -> { verdict:'fail', reason:'unknown_expectation' }

// 可失败性（D5）：violation seed 的 scope_violations 被清空 -> 检出率 < 100% -> fail
// cancelled seed：unresolved 非空断言成立才计入 Envelope 完整率分子
```

**Interface 设计检查**：`evaluateRun` 是本条与 hardening 条目 11 的共享 seam（单一事实源）；evals 报告刻意不进 core schema（评测产物自持，roadmap schema 清单不动）；无假 seam——评测函数有两个真实消费方（evals CLI 与 hardening 台账）。

### 2.2 编排层

**现状**：无。

**变化**：线性数据流，不画图：`seeds 目录 → 逐 seed evaluateRun → 三指标聚合 → JSON 报告 + exit 0/1`。无运行时编排、无状态。

**流程级约束**：evals 全程零 executor 零网络（纯离线重放）；seed 只读（evals 不修改 seed 目录，负例损坏在 seeds-negative 静态维护而非运行时注入）；exit 语义 0/1/2 对齐 4.5；采集脚本是种子进仓库的唯一通道（手工复制视为违规，review 抽检 seed.yaml 的 captured 字段与脚本输出一致性）。

### 2.3 挂载点清单

1. `npm run evals` / `npm run evals:capture` scripts — 新增（package.json）
2. CI 命令矩阵追加 `npm run evals` 行 — 修改
3. `evals/` 目录进 workspace 检查范围（biome / lint）— 新增
4. roadmap items.yaml 状态回写 — 修改

### 2.4 推进策略

1. evaluateRun 三指标纯函数 + mock 种子（pi-rpc mock 链路产物，`source: mock`）+ 单测 → 退出信号：三指标公式单测全绿（每指标 ≥1 正例 + 1 负例），关键假设（五件产物充分性）实证
2. evaluateLedger + 报告输出 + exit 语义（0/1/2 + unknown_expectation）→ 退出信号：mock 台账一键回归绿，非法元数据 exit 1，用法错误 exit 2
3. capture 采集脚本（复制 + 脱敏 + seed.yaml）+ 脱敏自检 grep 断言 → 退出信号：对 mock run 目录采集产出合法 seed 且自检过
4. seeds-negative ≥4 损坏种子（四类各对应一个指标分项）+ D5 可失败性断言进 `npm test` → 退出信号：负目录必产 fail verdict 的断言绿
5. 真实种子采集（上游 pi-rpc 验收产物 ≥5 个：2 clean + 1 cancelled + 2 violation，经 capture 准入门闩）替换 mock 台账 → 退出信号：`npm run evals` 对真实种子台账回归绿；2 个 violation seed 的 `result.json.unresolved` 非空断言过（Envelope 语义前提实证）；mock 种子迁移至 `packages/evals/test/fixtures/seeds-mock/`（不留 evals/seeds/，不进日常台账）
6. CI 矩阵接入 + 收口：items.yaml 回写 → 退出信号：CI 含 evals 行；Goal Coverage Matrix"npm run evals 一键回归"行证据齐全

### 2.5 结构健康度与微重构

##### 评估
- 文件级——被改文件：package.json scripts、CI 配置，各 1 处
- 目录级——packages/evals 与 evals/ 全新增，结构独立

##### 结论：不做

##### 超出范围的观察
- 台账趋势存储与阈值配置化（当前阈值硬冻结 100%/0）若 dogfood 出现合理例外，走 roadmap update——留观察项

## 3. 验收契约

关键场景清单：

1. 一键回归：`npm run evals` 对 ≥5 真实种子台账三指标全达阈值，exit 0，JSON 报告含逐 run 明细（roadmap 验收）
2. 三指标公式单测：每指标 ≥1 正例 + 1 负例；cancelled seed 计入 Envelope 分子当且仅当 unresolved 非空（与 pi-rpc D10 衔接的验收句）
3. 可失败性（D5）：seeds-negative 四类损坏各自导致对应指标分项 fail，断言进 `npm test`
4. exit 语义 e2e（挂 `npm test`，node --test 内 spawn evals CLI）：unknown_expectation → exit 1；用法错误 → exit 2
5. 采集脚本：对 run 目录产出五件产物 + seed.yaml 齐全的 seed，脱敏自检 grep 零命中；准入门闩拒绝不达预期产物（seed_rejected exit 1）
6. 误报子指标：clean seed 的 scope_violations 非空 → fail（阈值 0 生效）
7. hardening 复用契约：evaluateRun 无 meta 模式（scope skipped、契约与 Envelope 照算）+ RunEvalResult 形状断言，单测锁死导出面

明确不做的反向核对项：无新增 core schema（core diff 零 schema 变更）；无 executor / 网络调用（依赖审计：packages/evals 无 runner adapter import、无 fetch）；无 LLM 评审代码；不重复包装 check:research（机械门闩：`packages/evals` 内 grep `check:research|check-research|checkResearch` 零命中）。

### 3.x Acceptance Coverage Matrix

| Scenario | Covered By Step | Evidence Type | Command / Action | Core? |
|---|---|---|---|---|
| 一键回归真实种子台账 exit 0 | S5 | command | `npm run evals` | yes |
| 三指标公式正负例单测（含 cancelled 验收句） | S1 | test | `npm test` | yes |
| 可失败性断言（seeds-negative 四类） | S4 | test | `npm test` | yes |
| exit 语义 e2e（挂 npm test） | S2 | test | `npm test`（spawn evals CLI） | yes |
| 采集脚本 + 脱敏自检 + 准入门闩 | S3/S5 | test + command | `npm test` + capture 实跑 | yes |
| 误报阈值 0 生效 | S1/S4 | test | `npm test` | yes |
| violation seed unresolved 非空实证 | S5 | run artifacts | capture + 断言 | yes |
| evaluateRun 无 meta 模式 + 形状冻结 | S1 | test | `npm test` | yes |
| CI 矩阵接入 | S6 | diff review | CI 配置 diff | no |
| 明确不做反向核对（含 check:research grep 门闩） | S6 | diff review | grep + core diff | no |

注：Goal Coverage Matrix 中"npm run evals 一键回归"行的 `Core?=no` 是 epic 最小闭环维度的标记；本表 `Core?` 指条目内核心验收场景，两者维度不同。

### 3.y DoD Contract

| ID | 要求 | 证据 | 阻塞级别 |
|---|---|---|---|
| DOD-DESIGN-001 | design 完整且三指标公式与条目 11 定义逐字对齐 | design review | blocking |
| DOD-IMPL-001 | checklist steps 全完成且证据落盘 | checklist / evidence | blocking |
| DOD-REVIEW-001 | code review passed（含 seed 来源链抽检）无 unresolved blocking | review report | blocking |
| DOD-QA-001 | QA 覆盖可失败性断言与真实种子回归 | QA report | blocking |
| DOD-ACCEPT-001 | acceptance 回写（items）完成 | acceptance report | blocking |

Validation Commands:

| ID | 命令 | 目的 | 核心性 | 失败处理 |
|---|---|---|---|---|
| CMD-001 | `npm test` | 指标公式 + 可失败性 + 脱敏自检单测 | core | fix-or-block |
| CMD-002 | `npm run evals` | 真实种子台账一键回归 | core | fix-or-block |
| CMD-003 | `npx tsc --noEmit && npx biome check .` | 类型与 lint | core | fix-or-block |

Required Artifacts: review / QA / acceptance 报告、真实种子台账（≥5 seed 含 seed.yaml 来源链）、seeds-negative 四类、evals JSON 报告样本、CI 矩阵 diff。

## 4. 与项目级架构文档的关系

- 名词：seed / 指标 / 离线重放 / evals 报告 → acceptance 时提炼进 `requirements/CONTEXT.md`
- 动词骨架：无编排变化；evaluateRun 是与 hardening 条目 11 的共享判定函数（单一事实源）——此契约关系 epic 批量确认时提示 owner，无需 ADR
- 指标公式实证经验与种子采集坑 → compound（知识回写点）
