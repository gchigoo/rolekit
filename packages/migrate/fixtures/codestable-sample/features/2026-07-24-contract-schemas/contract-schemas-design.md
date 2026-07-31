---
doc_type: feature-design
feature: 2026-07-24-contract-schemas
requirement: ""
roadmap: rolekit-v2
roadmap_item: contract-schemas
execution_lane: goal
status: approved
summary: TypeBox 定义 9 类冻结契约 schema，两层校验（结构 + 语义），导出 JSON Schema，交付 compileTask 与 rolekit validate 最小 CLI，同时建立 monorepo 基线与 CI 命令矩阵
tags: [schema, typebox, contract, baseline, cli]
---

# contract-schemas design

## 0. 术语约定

| 术语 | 定义 | 防冲突结论 |
|---|---|---|
| 契约 schema | roadmap 4.1-4.10 冻结的 9 类数据契约（TaskContract/ResultEnvelope/ExecutorReport/RunEvent/GatePolicy/RoleProfile/ExecutorProfile/WorkItem/KnowledgeEntry） | 术语已在 `requirements/CONTEXT.md` 锁定，本 design 不新造名词 |
| 结构校验 | TypeBox schema 判定形状 / 类型 / 枚举 / 字面量 | 对应 JSON Schema 可表达部分 |
| 语义规则 | 跨字段规则（如 WorkItem gate 条件约束、Envelope 状态语义），JSON Schema 难表达，用 TS 函数实现 | 新词，grep 全仓无冲突；写入本 design 后进 CONTEXT.md 由 acceptance 提炼 |
| fixture | `fixtures/{kind}/valid-*` 与 `invalid-*` 样例（YAML/JSON；KnowledgeEntry 为 `.md`，见 D7.5），验收判定输入 | 与 evals-fixtures 条目的运行时评测区分：本条 fixture 只服务 schema 判定 |

## 1. 决策与约束

**需求摘要**：为 RoleKit v2 全部下游模块提供唯一契约地基。做什么：9 类 schema 的 TypeBox 定义 + 语义规则 + JSON Schema 导出 + `compileTask` + `rolekit validate` 最小 CLI + monorepo/CI 基线。为谁：runner/cli/migrate 等全部后续条目。成功标准：`rolekit validate` 对每类 schema ≥1 正例 + 2 负例 fixture 全部判定正确，CI 命令矩阵全绿。明确不做：不实现 run/执行逻辑；不发布 npm（只本地 workspace）；不引入 Ajv/zod/joi（TypeBox TypeCompiler 足够）；不做 validate 以外的 CLI 子命令；不写 RoleProfile 的 prompt 编译器（属 role-profiles-migration）。

**复杂度档位**：走"内部工具库"默认档位，一处偏离：schema 演进按"对外 SDK"档处理（版本字面量 `rolekit/xxx@1`、负例锁行为），原因：9 类 schema 是全体系最高改动成本的共享地基（roadmap §6）。

**关键决策**：

- D1 两层校验：结构层 = TypeBox TypeCompiler；语义层 = 每类 schema 附带的 `semanticRules(data) -> SemanticIssue[]` 纯函数。换成单层（全塞 JSON Schema 条件表达式）名词层会多出难维护的 `allOf/if/then` 树且错误信息不可读——故拆两层。`validateArtifact` 先结构后语义，任一层失败即 invalid。
- D2 校验器用 TypeBox 自带 TypeCompiler / Value.Errors，不引 Ajv：单依赖、错误含 instancePath，够 CLI 字段级报错。JSON Schema 导出仅作为跨语言/宿主消费产物，不作为运行时校验引擎输入。
- D3 monorepo 基线随本条建立：npm workspaces（不用 pnpm，对齐 ADR 004 的 npm 发布路径与 Windows 第一环境），`packages/{core,cli}` 先建，其余包目录随各自条目建立。
- D4 测试框架用 `node:test`（内置，零依赖，直接跑 `.ts`，对齐 ADR 004 erasable TS）。
- D5 lint/format 用 Biome（单二进制、Windows 友好、lint+format 一体）。被拒方案：ESLint+Prettier——插件链重、erasable TS 下收益低。owner 可在批量确认时翻案，替换成本仅限配置文件。
- D6 npm scope 建议 `@rolekit`（假设：该 scope 可注册；不可用则回退 `@rolekit-dev`，包名不影响代码结构）。本条只写 package.json 命名，不发布。
- D7 语义规则首批冻结清单（来源 roadmap 4.1-4.10 的条件约束，逐条落单测）：
  1. WorkItem：`status=awaiting-gate` ⇔ `gate` 非空（其余状态必为 null）
  2. ResultEnvelope：`status≠completed` ⇒ `unresolved` 非空；`scope_violations` 非空 ⇒ `status≠completed`
  3. TaskContract：`acceptance.commands` 至少一条；`scope.forbidden` 与 `scope.writable` 均为合法 glob 串（语法检查）
  4. WorkItem：kind=goal 转 done 的完成不变量属状态机运行时（workitem-lifecycle-core），schema 层不查——写入负例说明防误纳
  5. KnowledgeEntry：Knowledge `.md` 文本先经 core parser，再把 `{frontmatter,body}` 交 `validateArtifact`；semanticRules 只消费已切分 body，执行 Context/Decision/Consequences/Alternatives Considered 四节与 rule 单段断言，不做切分。读写 / 检索 / prompt 注入仍归 knowledge-layer 条目，本条只交付校验
  6. ExecutorProfile：`adapter` 为非空字符串（**结构约束**，TypeBox `minLength: 1`，对齐 roadmap 4.7"schema 只约束非空字符串"），schema **禁止**枚举取值（合法性由 runner 注册表判定，不在本条）——正例 fixture 须含一个未内置的 adapter 名（如 `openai-responses`）仍判定 valid；空串为**结构**负例
- D8 语义负例覆盖策略：每类 schema ≥2 负例；**有 D7 语义规则的类（TaskContract / ResultEnvelope / WorkItem / KnowledgeEntry 4 类）须含 ≥1 语义负例**，其余类（ExecutorReport / RunEvent / GatePolicy / RoleProfile / ExecutorProfile）2 负例均可为结构负例，不为凑数发明无契约依据的语义规则。ExecutorReport 虽含 status/unresolved 字段，但 Envelope 的状态语义规则不复制到它（完整率判定归 hardening 条目），防下游误用

**基线风险**：greenfield，无既有红灯；首次 CI 需在 Windows 本机全绿后再提交配置。

**Top 3 风险与缓解**：
1. schema 字段与 roadmap 4.1-4.10 漂移 → S2 含逐字段对照自查表（roadmap 节号 ↔ TypeBox 属性），review 时 diff 核对
2. TypeBox 表达力不足（discriminated union / 条件字段）→ S2 先做 RunEvent（7 变体 union）与 WorkItem（条件 gate）两个最难 schema 的 spike，失败即回 roadmap update 而不是绕开
3. Windows 上 `node --test` + type stripping 兼容坑 → S1 基线步先在本机跑通空测试矩阵，问题最早暴露

**非显然依赖**：Node >= 22.18（type stripping，ADR 004）；typebox 包版本需支持 JSON Schema draft 2020-12 导出；无外部服务依赖。Pi 兼容窗口声明属 pi-rpc-vertical-slice，本条 engines 只钉 Node。

**关键假设**：`@rolekit` scope 可用（D6 有回退）；TypeBox 对 4.4 的 7 变体 discriminated union 表达可行（roadmap 关键假设，S2 spike 验证）；YAML 解析用 `yaml` 包（人写产物，ADR 005）。

**必跑验证命令**：`npm test`、`tsc --noEmit`、`npx biome check .`、CLI e2e（spawn 真实进程断言 exit code 与 --json 输出）——全部在 Windows 本机执行，即 Windows smoke。

**交付物清单**（acceptance 按仓库事实反查）：根 `package.json`（workspaces）+ `tsconfig.json` + `biome.json` + CI workflow 文件；`packages/core`（9 个 schema 模块 + 语义规则 + validate + compileTask + errors）；`packages/cli`（`rolekit` bin + validate 子命令）；`schemas/json/*.json` 9 份导出；`fixtures/` 每类 ≥1 正 + 2 负；单测与 CLI e2e 测试文件；items.yaml 状态回写。

**清洁度规则**：禁止 console.log 调试残留（CLI 的用户输出走统一 output 模块除外）、禁止 TODO/FIXME 落盘、禁止注释掉的代码与无用 import；fixture 内容必须是有语义的样例而非 `foo/bar` 占位。

## 2. 名词与编排

### 2.1 名词层

**现状**：无现状，全新（仓库目前只有 `.codestable/` 与两份讨论文档）。

**变化**（全部新增）：

- `packages/core/src/schemas/*.ts`：9 类 schema，每文件导出三件套——TypeBox schema 对象、`Static` 类型、`semanticRules` 函数。字段以 roadmap 4.1-4.10 为唯一权威，不在本 design 重抄（重复即漂移源）。两处易错点显式钉死：`ExecutorProfile.adapter` 为非空 string 不做枚举（4.7）；`WorkItem.kind` 含 `goal`（4.9——`requirements/CONTEXT.md` 的 kinds 尚未回写 goal，以 4.9 为准，acceptance 时回写 CONTEXT）。
- `ValidationResult`（新）：校验统一返回值。
- `RolekitError` 基类 + `SchemaValidationError`（新）：错误模型，含 `code` 与字段级 issue 列表。

载荷约定：`validateArtifact` 只收已解析对象。除既有 `compileTask(yamlText)` seam 外，通用 validate 的非 Knowledge YAML/JSON 文本仍由 CLI/loader 读取并解析后传入；Knowledge `.md` 由 CLI/loader 只读文本，再调用 core 纯 `parseKnowledgeMarkdown` 得到 `{frontmatter,body}`。core 同时导出 `serializeKnowledgeDocument`；codec 在切分前 CRLF/CR→LF、body/文件均写 LF、frontmatter 固定键序。KnowledgeEntry 的载荷为 `{ frontmatter, body }`——frontmatter 走结构层，`body`（正文字符串）供 D7.5 type 断言消费。

接口示例：

```ts
// packages/core/src/validate.ts（新）
validateArtifact('rolekit/work-item@1', data)
// -> { valid: true } 
// -> { valid: false, issues: [
//      { layer: 'structural', path: '/status', message: 'expected one of ...' },
//      { layer: 'semantic',   path: '/gate',   message: 'status=awaiting-gate requires non-null gate' } ] }

// packages/core/src/compile-task.ts（新）
compileTask(yamlText)
// 正常 -> TaskContract（已通过结构 + 语义校验的冻结对象）
// 错误 -> throw SchemaValidationError（issues 同上，字段级）
```

kind（schema 标识）→ schema 的注册表 `schemaRegistry: Map<string, { schema, semanticRules }>`，validate CLI 与 migrate（后续条目）共用。

**Interface 设计检查**：module = core（deep：TypeBox 细节、TypeCompiler 缓存、语义规则全部藏在 core 内）；公开 seams 为 `validateArtifact`、`compileTask`、`parseKnowledgeMarkdown`、`serializeKnowledgeDocument`；四者均 in-process，codec/校验无 I/O。dependency strategy = in-process 纯函数；adapter = 无（纯数据契约）。JSON Schema 导出是产物不是接口——消费方（非 TS 宿主）拿文件不拿函数。

### 2.2 编排层

**现状**：无现状，全新。

**变化**：两条简单线性流程，免图理由：无分支/并行/状态机。

1. 校验流：通用 validate 非 md：CLI/loader 读并解析 YAML/JSON→validateArtifact；compileTask 保持既有 yamlText seam；Knowledge md：CLI/loader 读文本→core codec→validateArtifact。顺序约束：结构失败即短路，不跑语义层（避免对畸形数据跑规则抛异常）。`schema` 字段缺失或不在注册表 → `validation_error` 且稳定 `code: unknown_schema`。
2. CLI 流：`rolekit validate <file> [--json]` 按扩展名路由/读取；`.yaml/.yml/.json` 在 CLI/loader 解析，`.md` 只读文本并交 core `parseKnowledgeMarkdown`，禁止 CLI 切分 frontmatter；随后进入校验流与人读/JSON 出口。exit 约定对齐 roadmap 4.5：0 成功、1 校验/解析失败（`code` 区分 `parse_error` / `validation_error`）、2 用法错误（缺参、未知 flag）；`--json` 时 stdout 只有 JSON。

**流程级约束**：文件 I/O 与通用 validate 的非 md YAML/JSON 解析在 CLI/loader（compileTask 既有 yamlText seam 不变）；Knowledge markdown 纯切分/序列化只在 core codec；validateArtifact 始终只收已解析对象。CLI 是 core 的薄壳（roadmap §3：逻辑漏进 CLI 是审查红线）；错误输出 `--json` 时为单个 JSON 对象（stderr 留给非结构化日志）；JSON Schema 导出脚本幂等（重跑产物零 diff）。

### 2.3 挂载点清单

1. 根 `package.json` workspaces 声明：`packages/*` — 新增
2. `packages/cli/package.json` 的 `bin.rolekit` 注册 — 新增
3. CI workflow 文件（命令矩阵：test/typecheck/lint/CLI e2e，Windows 为第一执行环境）— 新增
4. `schemas/json/` 导出产物目录（跨宿主消费入口）— 新增
5. roadmap items.yaml 的 `contract-schemas` 状态回写 — 修改

### 2.4 推进策略

1. 仓库基线：workspaces + tsconfig（erasable）+ Biome + `node:test` 空测试 + CI 矩阵骨架（含空 e2e harness）→ 退出信号：test/typecheck/lint 三命令本机绿，空 e2e harness 可执行（真实 e2e 断言归 S6/S7）
2. 最难 schema spike：RunEvent（7 变体 union）+ WorkItem（条件 gate）→ 退出信号：两 schema 正/负例单测过；TypeBox 表达力不足则停，回 roadmap update
3. 其余 7 类 schema + 逐字段对照自查表 → 退出信号：9 类结构单测全过、自查表落盘
4. 语义规则层（D7 清单逐条，含 KnowledgeEntry `.md` type 断言）→ 退出信号：语义规则单测全过（每条规则 ≥1 正 + 1 负）
5. JSON Schema 导出脚本 → 退出信号：9 份 json 生成、重跑零 diff
6. compileTask + rolekit validate CLI → 退出信号：compileTask 单测过（正例与 fixture 深等、错例字段级 issues）+ CLI e2e 过（正例 exit 0、负例 exit 1、用法错误 exit 2、--json 结构断言）
7. fixture 套件收口（每类 ≥1 正 + 2 负，负例按 D8 策略分层）经真实 CLI 判定 → 退出信号：e2e 套件 spawn `rolekit validate` 遍历全部 fixture 判定正确（roadmap 验收字面路径；in-process 单测并行存在但不替代）

### 2.5 结构健康度与微重构

##### 评估
- 文件级——无既有源码文件被改动（greenfield）
- 目录级——仓库根：现有 `.codestable/` + 2 份 md，新增 `packages/`、`fixtures/`、`schemas/`、`scripts/`，同层目录 6 个，无摊平；`packages/core/src/schemas/` 落 9 个同构文件 + index，命名统一 kebab-case，属有意的按契约分文件，不算摊平

##### 结论：不做

无"超出范围的观察"。

## 3. 验收契约

关键场景清单：

1. 每类 schema 的正例 fixture → 真实 CLI `rolekit validate` exit 0（9 条；ExecutorProfile 正例含未内置 adapter 名）
2. 每类 schema 的结构负例（缺必填/错枚举/错版本字面量/ExecutorProfile adapter 空串）→ exit 1 且 issues 含 `layer: structural` 与正确 path（9 条）
3. 语义负例（D8 策略，4 类各 ≥1 条）：WorkItem awaiting-gate 且 gate null；ResultEnvelope completed 且 scope_violations 非空；TaskContract `acceptance.commands: []`；KnowledgeEntry type=adr 缺四节标题 / type=rule 多段正文 → 均 exit 1，`layer: semantic`
4. `compileTask` 正例 YAML → 返回对象与 fixture JSON 深等；错例 → SchemaValidationError 字段级 issues
5. 非法 YAML 输入 → exit 1，`code: parse_error`；缺 `schema` 字段或未知 kind → exit 1，`code: unknown_schema`
6. 用法错误：`rolekit validate`（缺参）、未知 flag → exit 2（roadmap 4.5）
7. `schemas/json/` 恰好 9 份、重跑导出零 diff
8. 边界：空文件、UTF-8 BOM 文件（Windows 常见）→ exit 1 报 parse_error 不崩溃

明确不做的反向核对项：`packages/` 下不出现 runner/migrate/adapters/profiles/evals 目录；`package.json` 依赖不含 ajv/zod/joi/eslint/prettier；CLI 无 validate 以外子命令（`rolekit --help` 输出断言）；无 npm publish 配置生效（`private: true` 或无 publishConfig）。

### 3.x Acceptance Coverage Matrix

| Scenario | Covered By Step | Evidence Type | Command / Action | Core? |
|---|---|---|---|---|
| 9 类正例 + 各 2 负例 fixture 经真实 CLI 全判定正确 | S7 | command | e2e 套件 spawn `rolekit validate` 遍历 fixtures | yes |
| RunEvent/WorkItem 最难 schema 表达可行 | S2 | test | `npm test` spike 用例 | yes |
| 语义规则清单逐条正/负（含 KnowledgeEntry .md 断言） | S4 | test | `npm test` | yes |
| compileTask 正例深等 + 错例字段级 issues | S6 | test | `npm test` compileTask 用例 | yes |
| CLI exit 0/1/2 与 --json 输出 | S6 | command | CLI e2e spawn 断言 | yes |
| JSON Schema 导出 9 份且幂等 | S5 | command + diff review | 导出脚本 + git diff | yes |
| 基线三命令绿 + 空 e2e harness 可跑（Windows） | S1 | command | test/typecheck/lint + harness 冒烟 | yes |
| BOM / 空文件 / unknown_schema 边界 | S6 | test | CLI e2e | no |
| 明确不做反向核对 | S7 | diff review | 目录与依赖清单核对 | no |

### 3.y DoD Contract

| ID | 要求 | 证据 | 阻塞级别 |
|---|---|---|---|
| DOD-DESIGN-001 | design 完整且契约可执行 | design review | blocking |
| DOD-IMPL-001 | checklist steps 全完成且证据落盘 | checklist / evidence | blocking |
| DOD-REVIEW-001 | code review passed 无 unresolved blocking | review report | blocking |
| DOD-QA-001 | QA 覆盖核心场景与必跑命令 | QA report | blocking |
| DOD-ACCEPT-001 | acceptance 回写与审计完成 | acceptance report | blocking |

Validation Commands:

| ID | 命令 | 目的 | 核心性 | 失败处理 |
|---|---|---|---|---|
| CMD-001 | `npm test` | 单测（含 in-process 校验用例，不替代 CLI fixture 验收） | core | fix-or-block |
| CMD-002 | `npx tsc --noEmit` | 类型检查 | core | fix-or-block |
| CMD-003 | `npx biome check .` | lint/format | core | fix-or-block |
| CMD-004 | `node --test test/e2e/` | CLI e2e | core | fix-or-block |

Required Artifacts: review / QA / acceptance 报告、命令输出日志、`schemas/json/` 产物、fixture 目录。

## 4. 与项目级架构文档的关系

- 名词：`ValidationResult` / 语义规则 / schemaRegistry → acceptance 时提炼进 `requirements/CONTEXT.md`
- 约束：两层校验（D1）与"校验器不引第三方"（D2）若经实现验证成立，建议 acceptance 后补一条轻量 ADR 或并入 ADR 004 的 consequences
- D5（Biome）、D6（npm scope）由 owner 在批量确认时定案，定案后写入 `.codestable/attention.md`
