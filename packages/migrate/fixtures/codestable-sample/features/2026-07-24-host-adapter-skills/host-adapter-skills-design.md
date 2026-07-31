---
doc_type: feature-design
feature: 2026-07-24-host-adapter-skills
requirement: ""
roadmap: rolekit-v2
roadmap_item: host-adapter-skills
execution_lane: goal
status: approved
summary: pi/codex/cursor 三份薄 Skill 入口，共享命令映射单一事实源 + 生成脚本防漂移，命令白名单与行数上限做 ADR 001 机械守护，委派判据机械化（check:delegation 脚本 + skill hash），验收锚定 pi + cursor 两宿主真实委派 run
tags: [adapters, skills, cli, host]
---

# host-adapter-skills design

## 0. 术语约定

| 术语 | 定义 | 防冲突结论 |
|---|---|---|
| 宿主 Skill | 教宿主 agent 何时及如何驱动 `rolekit` CLI 的 Markdown 入口文件（含 frontmatter），每宿主一份 | 与 CodeStable 的 cs-* skills 无关；也不是 Pi capability pack |
| 命令映射 | Skill 内"意图 → rolekit 子命令"的对照表，唯一允许的操作性内容 | 新词，无冲突 |
| 委派 run | 宿主 agent 读取 Skill 后，对一个真实契约执行 `task compile → run start → run status → collect/verify` 全命令链并产出 run artifacts 的一次执行 | 验收单位，区别于裸 CLI 手工调用（"经 Skill"判据机械化见 D5） |
| 薄度守护 | 对 adapter 文件的机械断言集合：命令白名单 + 行数上限 + 禁词 | ADR 001"Skill 不承载工作流语义"的可判定代理 |

RoleProfile / TaskContract / RunEvent 等以 roadmap 4.1-4.10 冻结定义为准，不重抄。

## 1. 决策与约束

**需求摘要**：为 pi / codex / cursor 三宿主各交付一份薄 Skill 入口，教宿主驱动 `rolekit` CLI（4.5 冻结命令面）。为谁：owner 混用多宿主的日常工作流（ADR 001 动机）。成功标准 = roadmap 条目 3：至少 2 宿主各完成 ≥1 次经 Skill 驱动 CLI 的委派 run。明确不做：Skill 内任何工作流语义（状态机、gate 决策、prompt 拼装、lane 选择——出现即违反 ADR 001）；MCP 包装层（ADR 001 定为后置）；新增 CLI 子命令（4.5 命令面冻结，安装走文档化复制 + npm script，不进 CLI 表面）；宿主端自动安装器。

**复杂度档位**：刻意 shallow（roadmap §3 模块 adapters 的 Depth 判断）——本条的设计难点不在深度而在防漂移与防语义泄漏，两者都用机械手段守护。

**关键决策**：

- D1 三宿主入口形态：pi = `SKILL.md`（Pi skill 目录约定，frontmatter 含 name/description/compatibility，参考 pi-delivery-rolekit 的 skills 形态，只读参考）；cursor = `SKILL.md`（Cursor Agent Skills 约定，frontmatter 含 name/description）；codex = Markdown 提示文件（仓库级 `AGENTS.md` 片段 + 可复制的 prompt 文件），实现期以当版 Codex 文档核实落位路径为准。三份源文件落 `adapters/{pi,codex,cursor}/`。
- D2 验收宿主选取：**pi + cursor** 为验收锚定宿主（owner 环境确定可用）；codex 入口照常交付但**不计入本条验收**（owner 环境 Codex 可用性不确定；若实测可用可作附加证据，不改变验收判定）。
- D3 内容红线（ADR 001 机械化）：Skill 只允许四类内容——何时使用（触发描述）、命令映射表、产物读取位置（`.rolekit/runs/<id>/` 五件产物名）、升级路径（CLI 报错原样回报用户，不自行决策）。薄度守护四断言（约束对象 = 三份宿主产物文件；README 只受禁词断言约束且其中命令行仅允许复制/安装类）：(a) **正选模式**——产物代码块与行内出现的全部命令行必须匹配 `rolekit <可用区子命令> [允许 flag]` 模式（可用区枚举见 D6；**flag 白名单冻结**：全局允许 `--json`，`run start` 另允许 `--detach`，其余 flag 即失败），任何其他调用形态（`node`、`npx`、绝对路径 bin、`curl` 等）即 lint 失败，杜绝绕开 4.5 表面；(b) 每份 adapter 产物生成后全文 ≤200 行（含 frontmatter 与空行）；(c) 禁词表 grep 零命中（英文词按词界匹配防误伤，如 `\blane\b`），初值冻结为：`awaiting-gate`、`transition`、`state machine`、`状态机`、`状态转移`、`lane`、`gate 决策`、`escalation`、`compilePrompt`、`prompt 拼装`、`GatePolicy`（词表落 lint 脚本，扩充走 code review）；(d) 零 diff（见 D4）。四断言进 `npm run lint:adapters`，CI 必跑。
- D4 防漂移单一事实源：命令映射与产物说明写在 `adapters/shared/command-map.md`（唯一事实源，含"可用区"与"规划中"两节）；`adapters/build.mjs` 生成脚本把**可用区** + 各宿主特有段（frontmatter、触发措辞、落位说明）拼装为三份产物——**规划中节不进任何宿主产物**，只留在 command-map 源文件（每项标注所属 roadmap 条目），lint 断言产物中无规划中命令；**生成物提交入库**（diff 可见）；lint 断言"重新生成零 diff"（防手改产物绕过源文件）。生成脚本属仓库侧构建工具，不在 Skill 内，不违反 ADR 001。
- D5 委派 run 的"经 Skill 驱动"机械判据：每宿主 1 次委派 run 的证据三件套——(1) run 目录五件产物（task.json/prompt.md/events.jsonl/result.json/verification.json）全过 `rolekit validate`；(2) 宿主会话记录（Pi 会话导出 / Cursor 聊天导出）通过 `npm run check:delegation -- <会话文件> <run目录>` 机械断言：会话含 Skill 名（`rolekit-adapter-pi` / `rolekit-adapter-cursor`）加载证据、会话中全部 `rolekit` 命令行 ⊆ command-map 可用区、CLI 非零 exit 后无契约文件修改命令且下一条 rolekit 命令仅限查询类（status/collect）——覆盖"报错原样回报不自行决策"；(3) skill 版本绑定（操作约束）：验收规程强制"`npm run install-skill:<host>` 后立即执行委派 run，期间不改 adapters/"，归档执行时刻的 git rev + 三份产物 sha256（对应 Goal Coverage Matrix 的 skill diff 证据）——安装与执行同刻绑定即视为会话所用 Skill 与仓库版本一致（不要求会话导出携带 digest）。契约用 pi-rpc-vertical-slice 的 dogfood 契约或同级最小真实契约，不造假任务。check:delegation 的命令行匹配同样执行 D3 的 flag 白名单（`--json` 全局、`--detach` 仅 run start）。
- D6 可用区枚举与命令边界（冻结）：可用区 = `validate`、`task create|compile`、`run start|status|cancel|collect`、`verify`（全部为 pi-rpc-vertical-slice 已交付命令）；`run steer` 放规划中并标注"capabilities 未声明，调用返回 unsupported_operation"；`workitem`、`migrate` 放规划中并标注所属条目（workitem-lifecycle-core / migrate-tool）。可用区命令映射默认教宿主带 `--json`（4.5：`--json` 时 stdout 只有 JSON，供 agent 机械消费，降低解析人读输出的伪工作流风险）。
- D7 安装方式：每宿主目录内 README 写明复制目标路径（pi：Pi skills 目录；cursor：`.cursor/skills/` 或用户级 skills 目录；codex：实现期核实并把核实日期写入 README）；提供 `npm run install-skill:pi|cursor|codex` 复制便利脚本。不做 symlink（Windows 权限坑）、不做自动检测。

**基线风险**：依赖 pi-rpc-vertical-slice 严格 done（run 命令面真实可用）后才能进入验收步；design 先行不受影响（epic 批量 design admission）。

**Top 3 风险与缓解**：
1. 宿主对 Skill 的触发可靠性（description 措辞决定宿主 agent 是否选中）→ 验收本身即触发测试；触发失败先修 description 措辞，不加逻辑
2. Codex 入口格式随版本漂移 → D2 已排除出验收；实现期核实一次，README 注明核实日期
3. 三份产物与共享源漂移 → D4 生成 + 零 diff 断言

**非显然依赖**：pi-rpc-vertical-slice 的 `rolekit task/run/verify` 命令面与 runs 落盘（实现前置，严格 done）；Pi / Cursor 宿主的 skill 加载机制（owner 环境已具备）；可用区/规划中的划分以 D6 冻结枚举为准（规划中命令不进宿主产物，D4）；宿主会话导出格式（Pi / Cursor 各自的导出能力，check:delegation 解析两种格式，实现期钉解析口径）。

**关键假设**：宿主 agent 能按 SKILL.md 的命令映射发起 shell 命令（Pi / Cursor 均具备 shell 工具）；委派 run 使用的契约在宿主侧无需任何 RoleKit 内部知识即可完成命令链。

**必跑验证命令**：`npm run lint:adapters`（正选模式 + 行数 + 禁词 + 零 diff 四断言）、`npm run check:delegation`（两宿主会话 + run 目录机械判据）、`npx biome check .`、两宿主委派 run 的 `rolekit validate` 产物校验；全部 Windows 本机。

**交付物清单**：`adapters/shared/command-map.md`、`adapters/build.mjs`、`adapters/{pi,codex,cursor}/SKILL.md`（codex 为对应格式产物）+ 各 README、`scripts/lint-adapters.mjs` 与 `scripts/check-delegated-run.mjs`、package.json scripts（`lint:adapters` / `check:delegation` / `install-skill:*` / `build:adapters`）、两宿主委派 run 证据三件套（run 目录 + 会话记录 + skill sha256/git rev 对照）、items.yaml 回写。

**清洁度规则**：禁止在 Skill 产物中出现 TODO/FIXME；禁止把 run 内部结构细节（events 事件类型枚举、Envelope 字段）复制进 Skill（只给产物文件名与读取入口）；lint 脚本无调试输出。

## 2. 名词与编排

### 2.1 名词层

**现状**：contract-schemas + pi-rpc-vertical-slice 交付 core/runner/cli；`adapters/` 目录无现状，全新。

**变化**（全部新增）：

- `adapters/shared/command-map.md`：命令映射唯一事实源（含"可用"与"规划中"两区）
- `adapters/build.mjs`：拼装生成脚本（读 shared + 宿主片段 → 写三份产物）
- `adapters/pi/SKILL.md` + `adapters/pi/README.md`：Pi 宿主入口 + 安装说明
- `adapters/cursor/SKILL.md` + `adapters/cursor/README.md`：Cursor 宿主入口 + 安装说明
- `adapters/codex/`（产物文件名实现期核实）+ README
- `scripts/lint-adapters.mjs`：薄度守护四断言（正选模式 / 行数 / 禁词 / 零 diff）
- `scripts/check-delegated-run.mjs`：委派判据脚本（Skill 名加载证据 / 命令 ⊆ 可用区含 flag 白名单 / 报错后行为，D5；skill 版本绑定是验收归档操作约束，不属脚本比对）

**Interface 设计检查**：本条无运行时接口——adapter 是文档产物，seam 是 4.5 CLI 命令面（已由上游冻结与交付）。dependency strategy = 消费既有 seam，不新建。刻意 shallow 由薄度守护保证，不靠自觉。

### 2.2 编排层

**现状**：无现状。

**变化**：生成与守护为线性流程，不画图：`command-map.md 可用区 + 宿主片段 → build.mjs → 三份产物 → lint-adapters.mjs（正选模式/行数/禁词/零 diff）→ CI`；验收侧：`宿主会话导出 + run 目录 → check-delegated-run.mjs → 委派判据裁定`。委派 run 流程完全走宿主 agent + 既有 CLI，本条不新增任何运行时编排。

**流程级约束**：产物必须由 build.mjs 生成（手改产物 = 零 diff 断言失败）；可用区以 D6 冻结枚举为准，规划中命令不进宿主产物（D4，lint 断言）；Skill 不得指导宿主直接读写 `.rolekit/` 内部文件（只读五件产物 + 用 CLI 查询）；命令映射默认教 `--json`（D6）。

### 2.3 挂载点清单

1. `adapters/` 目录加入 workspace 检查范围（biome / lint 脚本）— 新增
2. 根 package.json scripts：`lint:adapters`、`check:delegation`、`install-skill:pi|cursor|codex`、`build:adapters` — 新增
3. CI 命令矩阵追加 `npm run lint:adapters`；check:delegation 的 fixture 正负例断言以单测形式进 `npm test`（CI 既有命令，回归有门闩）— 修改
4. roadmap items.yaml 状态回写 — 修改

### 2.4 推进策略

1. `adapters/` 骨架 + command-map.md（可用区按 D6 冻结枚举：validate / task create|compile / run start|status|cancel|collect / verify）+ build.mjs + lint-adapters.mjs + check-delegated-run.mjs → 退出信号：`npm run lint:adapters` 四断言绿（对生成产物）+ check:delegation 对 fixture 会话（1 正例 + 2 负例：命令超可用区 / 缺 Skill 加载证据）判定正确且断言进 `npm test`
2. pi SKILL.md 宿主片段 + 生成 + 安装到 owner Pi 环境 → 退出信号：Pi 宿主经 Skill 完成 1 次委派 run，证据三件套齐（五件产物过 validate + check:delegation 通过 + skill hash 对照归档）
3. cursor SKILL.md 宿主片段 + 生成 + 安装 → 退出信号：Cursor 宿主经 Skill 完成 1 次委派 run，同口径证据三件套齐
4. codex 入口产物 + README（落位路径实现期核实）→ 退出信号：产物过 lint 四断言 + 核实日期已写入 README（不要求委派 run，D2）
5. 收口：证据归档 + items.yaml 回写 → 退出信号：Goal Coverage Matrix 行"2 宿主经薄 Skill 驱动同一 CLI 各 ≥1 次委派"证据齐全（run artifacts + skill diff/hash 两类证据均在）

### 2.5 结构健康度与微重构

##### 评估
- 文件级——被改文件仅根 package.json（scripts 追加）与 CI 配置：改动点 ≤2 处
- 目录级——`adapters/` 新建 3 宿主目录 + shared，结构即文档，无摊平

##### 结论：不做

##### 超出范围的观察
- 无

## 3. 验收契约

关键场景清单：

1. Pi 宿主委派 run：宿主 agent 依 SKILL.md 对真实契约走完 `task compile → run start → run status → collect/verify`，证据三件套（D5）：五件产物全过 `rolekit validate` + `check:delegation` 机械判定通过（Skill 名加载证据、命令 ⊆ 可用区）+ skill sha256/git rev 对照归档
2. Cursor 宿主委派 run：同场景 1 口径
3. 正选模式断言：三份产物中全部命令行匹配 `rolekit <D6 可用区>` 模式，无 node/npx/绝对路径/curl 等其他调用形态，无规划中命令
4. 行数上限：每份产物生成后全文 ≤200 行（含 frontmatter 与空行）
5. 禁词断言：D3 冻结禁词表 grep 零命中
6. 零 diff 断言：重新运行 build.mjs 后 `git diff --exit-code adapters/` 通过（防手改产物）
7. 升级路径：CLI 非零 exit 后宿主原样回报用户——`check:delegation` 机械断言（error 后无契约文件修改命令、无查询类之外的 rolekit 命令）+ 会话记录人工复核双重覆盖
8. check:delegation 自身可证伪：fixture 会话 1 正例 + 2 负例（命令超可用区；缺 Skill 加载证据）判定正确，断言以单测进 `npm test`（CI 回归）

明确不做的反向核对项：三份产物无状态机/gate/lane/prompt 拼装内容（禁词 + 评审双重核对）；无新增 CLI 子命令（cli 包 diff 为零）；无 MCP 相关文件；无 symlink / 自动安装检测代码。

### 3.x Acceptance Coverage Matrix

| Scenario | Covered By Step | Evidence Type | Command / Action | Core? |
|---|---|---|---|---|
| Pi 宿主委派 run 证据三件套（产物 validate + check:delegation + skill hash） | S2 | run artifacts + skill diff/hash + command | 宿主真机执行 + `rolekit validate` + `npm run check:delegation` | yes |
| Cursor 宿主委派 run 证据三件套 | S3 | run artifacts + skill diff/hash + command | 同上 | yes |
| 正选模式 / 行数 / 禁词 / 零 diff 四断言 | S1 | command | `npm run lint:adapters` | yes |
| check:delegation 正负 fixture 判定正确（1 正 + 2 负） | S1 | test | `npm test`（CI 回归） | yes |
| 升级路径不自行决策（error 后行为） | S2/S3 | command + 会话记录复核 | `check:delegation` 断言 + 人工复核 | yes |
| codex 产物过 lint + 核实日期入 README（不要求委派 run） | S4 | command | `npm run lint:adapters` | no |
| 明确不做反向核对 | S5 | diff review | grep + cli 包零 diff | no |

### 3.y DoD Contract

| ID | 要求 | 证据 | 阻塞级别 |
|---|---|---|---|
| DOD-DESIGN-001 | design 完整且两宿主验收可执行 | design review | blocking |
| DOD-IMPL-001 | checklist steps 全完成且证据落盘 | checklist / evidence | blocking |
| DOD-REVIEW-001 | code review passed 无 unresolved blocking | review report | blocking |
| DOD-QA-001 | QA 覆盖两宿主委派、四断言与 check:delegation（CMD-004） | QA report | blocking |
| DOD-ACCEPT-001 | acceptance 回写与审计完成 | acceptance report | blocking |

Validation Commands:

| ID | 命令 | 目的 | 核心性 | 失败处理 |
|---|---|---|---|---|
| CMD-001 | `npm run lint:adapters` | 薄度守护四断言 | core | fix-or-block |
| CMD-002 | `npx biome check .` | lint/format | core | fix-or-block |
| CMD-003 | `rolekit validate <artifact>` | 两宿主 run 五件产物校验 | core | fix-or-block |
| CMD-004 | `npm run check:delegation -- <会话> <run目录>` | 委派判据机械裁定 | core | fix-or-block |

Required Artifacts: review / QA / acceptance 报告、两宿主委派 run 目录 + 会话记录 + skill sha256/git rev 对照（Goal Matrix 的 skill diff 证据）、lint:adapters 与 check:delegation 输出、codex 落位路径核实记录（含日期，写入 README）。

## 4. 与项目级架构文档的关系

- 名词：宿主 Skill / 命令映射 / 薄度守护 → acceptance 时提炼进 `requirements/CONTEXT.md`
- 动词骨架：无运行时编排，不涉 ADR；若实现期发现 Skill 必须携带逻辑才能驱动宿主，即 ADR 001 的边界失效信号——停下走 roadmap update，不得就地加逻辑
- 宿主触发措辞的有效写法与 Codex 落位核实结论 → compound（知识回写点）
