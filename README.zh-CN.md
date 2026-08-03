# RoleKit

RoleKit 提供可跨宿主使用的角色与任务契约，用来调用编码 Agent；它不拥有 Agent loop，也不管理项目工作流。

仓库只保留一个宿主无关的最小 core，以及彼此独立的 Pi、Cursor、Codex CLI adapter。应用负责显式注册角色与
adapter、为每次运行选择唯一 executor，并消费标准化的 `RunResult`。

## 设计原则

- **可移植契约**：只定义 `RoleSpec`、`TaskPacket`、`ExecutorDescriptor`、`RunResult`。
- **显式路由**：每次运行必须指定 executor；core 不自动回退。
- **能力准入**：executor 缺少必需能力时直接返回 `blocked`，且不会调用 adapter。
- **运行时类型校验**：角色输入、输出均按 JSON Schema 校验。
- **真实来源**：结果记录实际 executor/model，artifact 记录 run 与 executor provenance。
- **adapter 独立**：Pi、Cursor、Codex 以及第三方 adapter 都在 core 之外。

RoleKit 不再包含工作项生命周期、gate、重试策略、持久化、worktree 管理、迁移框架、评测 campaign 或
“项目是否完成”的判断。

## 执行职责边界

```text
Host harness（位于 RoleKit 之外）
  -> RoleKit config/compiler
  -> ExecutionPlan
  -> host-native executor 或 bundled adapter
  -> ExecutionReceipt(planDigest + actual executor + ExecutorResponse)
  -> RoleKit digest 一致性检查与 finalizer
  -> RunResult v2
```

Host harness 负责 orchestration、workspace 生命周期、重试、gate 与强隔离。Claude Code、Grok、Codex、
Cursor 仅仅调用 RoleKit 时不需要 host adapter；只有当 RoleKit 要把任务委托给该 runtime 时才需要添加
executor adapter。Host-native 路径使用 `compile → receipt → finalize`，bundled delegation 则围绕唯一选中的
adapter 使用相同的 plan、receipt 与 finalization 语义。

## 环境要求

- Node.js 22.18+
- 至少一个支持的编码 Agent CLI，或应用自行提供的 adapter

```powershell
npm.cmd install
npm.cmd run check
```

在许可证与发布动作被明确批准前，package 保持 `private`。

## CLI

配置驱动 CLI 只加载一个显式 config graph，并且只选择角色默认 profile 或调用方显式覆盖的一个
profile；它不会扫描 package，也不会回退到其他 profile。

```powershell
node .\bin\rolekit.js config validate --config .\examples\rolekit.yaml
node .\bin\rolekit.js compile `
  --config .\examples\rolekit.yaml `
  --role reviewer `
  --task .\examples\tasks\implement-feature.yaml `
  --executor host-reviewer `
  --json
node .\bin\rolekit.js run `
  --config .\examples\rolekit.yaml `
  --role implementer `
  --task .\examples\tasks\implement-feature.yaml `
  --json
node .\bin\rolekit.js finalize --plan .\resolved-plan.json --receipt .\execution-receipt.json --json
node .\bin\rolekit.js executors list --config .\examples\rolekit.yaml --json
node .\bin\rolekit.js executors describe `
  --config .\examples\rolekit.yaml `
  --executor pi-implementer `
  --probe `
  --json
```

`config validate`、`compile` 和默认的静态 `executors describe` 不读取环境变量中的 secret，也不 probe
可执行文件。`compile` 会执行 task-aware 静态准入，并始终输出带完整性绑定的
`ResolvedExecutionPlan`；若准入被拒绝则退出码为 4，宿主不得执行该 plan。Host profile 必须走
`compile`/`finalize`，不会伪装成 adapter。只有配置驱动的 adapter `run` 才会解析声明的环境变量引用，
并 probe/调用唯一选中的可执行文件。`executors describe --probe` 只以静态 prepared options 执行无凭据的
version/help 检查，不进行认证。

**安全警告：**编译后的 plan 不包含已解析的凭据，但会嵌入完整的规范化 role、task、input、context、constraints 和 acceptance criteria 快照。即使 plan 不含凭据，也必须将其视为潜在敏感数据。JSON 模式的 `compile` 输出是 CLI envelope；host 供 `finalize` 使用时，只提取并持久化 `data` 作为 resolved-plan 文档，不要保存整个 CLI envelope。

每个 `--json` 命令只向 stdout 写一个文档：

```json
{"ok":true,"data":{},"warnings":[]}
```

错误使用 `{"ok":false,"error":{"code":"...","message":"..."},"warnings":[]}`。CLI warning 不会写入
plan 或 result。退出码统一为：`0` 成功，`1` 执行/finalize 失败，`2` 用法错误，`3` config/contract
无效，`4` blocked 或需要 host 执行，`130` SIGINT，`143` SIGTERM；退出码不会改变 envelope 结构。

旧的 `run --role <file> --executor ... --options ...` 形式保留一个弃用周期。只有缺少 `--config` 时才会
识别为旧模式；文本模式在 stderr 输出警告，JSON 模式只在 envelope 的 `warnings` 数组中输出
`legacy_run_deprecated`。

Cursor adapter 使用当前官方的 `agent` 可执行文件，并默认启用 `--sandbox enabled`；`--trust`
只用于无头模式下的 workspace trust，不代表文件系统 allowlist。只读任务进入 plan mode，拥有
`repository.write` 的任务进入 forced mode。若任务要求 `shell` 但不要求 `repository.write`，
adapter 会在 probe 之前返回 `unsupported_permission_combination`，因为 Cursor 无法可靠保证该权限
组合。旧的 `cursor-agent` 只有在显式配置 `command` 时才会使用，并返回弃用诊断；不会自动回退。

Pi 默认禁用 session、context files、extension/skill/prompt-template discovery，并使用临时空的用户
Agent 目录、受控 system prompt 和按本次准入能力派生的显式工具 allowlist；Pi 不提供独立 approval flag。可以配置精确的
extension、skill、prompt-template 路径而不打开 discovery；`discoverProjectResources` 是独立的显式
不安全 opt-in。若角色要求 `shell` 却不要求 `repository.write`，adapter 会在 probe 前阻止执行：Pi 的
`bash` 工具能够写文件，因此在没有 fixture 证明写隔离前不会声称支持该权限组合。Grok 4.5 prompt
profile 仍完全位于 adapter 内，显式 thinking 使用类型化的 `thinking` 字段。

Codex 默认添加 `--ignore-user-config`、`--ignore-rules`，并计划设置
`project_doc_max_bytes=0`。其中 `--ignore-rules` 隔离的是 execpolicy rules，不是 `AGENTS.md`；项目
instructions 由独立选项控制。静态 inspect 会把项目 instructions 标为 `unknown`；只有精确类型化控制通过
有界 differential parser canary 后，runtime admission 才会升级为 `isolated`。显式继承项目 instructions
时会如实报告 `inherited` 并跳过该 canary。选择 web search 时，descriptor 与静态 admission 会声明
`web`，使要求 web 的请求既满足 descriptor 一致性又能进入强制 runtime probe；runtime admission 只有在
`web_search="live"` 通过条件化类型 canary 后才保留该能力，否则阻止执行。在有 fixture 证明可以禁用项目级
resources/MCP 之前，descriptor 会诚实地把 `projectResources` 标为 `unknown`。

共享进程选项只包含 `command`、`timeoutMs`、`maxOutputBytes`、`environment`，以及显式不安全
opt-in `inheritAmbientEnvironment`。安全模式绝不会从 `process.env` 复制 adapter 认证值或 config-home；
凭据必须在敏感的 `environment` 选项中显式提供。公共快照用 marker 替代字面值，有效选项同时记录凭据
来源集合和显式环境变量名。Pi 与 Cursor 在安全执行时使用临时隔离的用户 home，Codex 默认也使用临时
隔离 home。Pi 的 `inheritUserAgentDirectory: true` 与 Codex 的 `inheritUserConfig: true` 会显式允许
用户凭据存储，并报告 `credentials: 'user-store'`；`inheritAmbientEnvironment: true` 则报告
`credentials: 'inherited'`。若同时启用用户存储并提供显式凭据 key，descriptor 会保守报告
`credentials: 'unknown'`，有效公共选项仍保留两类来源。Codex behavior canary 始终使用单独分配的最小
环境和全新的临时隔离 home/store；version/help 不会使用该路径，因此显式配置凭据、ambient
credential/token 变量和继承的用户存储都不会进入 canary；version/help 写入其所选 home/store 的
credential/config/cache 状态也无法通过 canary 的 home/store 路径读取。实际执行仍保持调用方选择的独立环境策略。

Pi、Codex、Cursor 各自导出严格的类型化选项。未知字段、保留环境变量、`commandArgs`、`extraArgs`、
任意 capabilities 声明和 raw config override 都会在 probe 之前被拒绝。Probe 会把 help 输出解析成
精确 option token，并从准备后的实际执行参数计划推导必需 token，包括条件类型化选项。三个内置
adapter 都只把任务 `allowedPaths` 声明为 advisory，不声称精确文件路径隔离。

## pre-1.0 adapter 协议迁移

PR 3 会显式破坏旧 adapter 源码兼容性，不提供静默 shim：

| 旧 API | 新 API |
| --- | --- |
| `describe(options)` | `prepareOptions(options, publicContext?)` 后调用纯函数 `inspect(prepared)` |
| descriptor 内携带 availability | `probe(prepared, { cwd, signal? })` 返回运行时诊断 |
| 仅由 core 比较 capabilities | 每次运行调用 `admit(role, task, prepared, probe?)` |
| `execute` 接收原始 options | 接收准备后的类型化 options、admission 与敏感值集合 |

`Rolekit.run()` 的顺序是 `prepare → inspect → static admit → probe → runtime admit → execute`；
`Rolekit.compile()` 在 static admission 后停止，不访问文件系统，也不启动进程。Adapter 通过
`sensitiveOptionPointers` 声明允许 marker 出现的根路径；core 与 conformance helper 会拒绝可变的准备
快照、非对象 `publicOptions`、公共/有效选项中的敏感字面值，以及声明路径之外的 marker。准备完成后，
inspect/admit/probe/execute 的所有诊断都会用准备好的敏感值集合脱敏。请求的 provider/model 只属于
配置；最终 executor identity 只能来自 adapter 实际观察到的响应以及 probe 版本。

旧的无 discriminator descriptor 文档继续由 `ExecutorDescriptorV1` 和
`ExecutorDescriptorV1Schema` 读取。新的 adapter 必须实现 `rolekit/executor-adapter@1`，并返回带
`rolekit/executor-descriptor@2` discriminator 的 V2 descriptor。V1 文档不会被重新解释成 V2
conformance；`schemas/` 同时导出独立的 V1 与 V2 schema。

## 公共能力与状态

能力只有：

- `repository.read`
- `repository.write`
- `shell`
- `web`
- `vision`

终态只有：

- `completed`
- `failed`
- `blocked`
- `cancelled`

## 稳定 package entry point

代码入口固定为 `.`、`core`、`config`、`adapter-cli`、`pi`、`pi-rpc`、`cursor`、`codex` 和
`testing`。版本化 JSON Schema 从 `schemas/role-spec.v1`、`schemas/task-packet.v1`、descriptor/config/
execution-plan/receipt 以及 RunResult v1/v2 路径导出。历史文件 `run-result.schema.json` 继续指向 v1；
显式的 `schemas/run-result.latest` 指向 v2，不会静默重定向历史兼容 alias。

## 扩展 executor

实现 `ExecutorAdapter` 并在构造 `Rolekit` 时注册即可。core 没有按宿主分支的 switch，也不会因为增加第四个
adapter 而修改。

## 发布审批 gate

Package 保持 `private: true`。发布前必须由 owner 完成全部步骤：

1. 批准许可证。对可复用 adapter 生态，Apache-2.0 是推荐默认值，但最终选择属于产品/法律决策。
2. 添加获批的 `LICENSE` 文件与 package `license` 字段。
3. 运行 `npm run check`、`npm run test:package` 和真实 CLI smoke suite。
4. 检查 `npm pack --dry-run --json`。
5. 只有完成以上步骤后才能移除 `private` 并发布。

没有 owner 的明确批准，任何实现 agent 都不得选择许可证、移除 private gate 或发布。

## 边界文档

- [架构](docs/architecture.md)
- [配置](docs/configuration.md)
- [安全模型](docs/security-model.md)
- [兼容性策略](docs/compatibility.md)
- [Veritack 集成边界](docs/veritack.md)
- [English README](README.md)
