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

## 环境要求

- Node.js 22.18+
- 至少一个支持的编码 Agent CLI，或应用自行提供的 adapter

```powershell
npm.cmd install
npm.cmd run check
```

在许可证与发布动作被明确批准前，package 保持 `private`。

## CLI

```powershell
node .\bin\rolekit.js validate role .\examples\roles\implementer.yaml
node .\bin\rolekit.js validate task .\examples\tasks\implement-feature.yaml
node .\bin\rolekit.js run `
  --role .\examples\roles\implementer.yaml `
  --task .\examples\tasks\implement-feature.yaml `
  --executor cursor `
  --options .\examples\options\cursor.json `
  --json
```

Cursor adapter 使用 `cursor-agent` 无头 CLI：只读任务进入 plan mode，需要写入或 shell 的任务使用强制
非交互模式。prompt 通过标准输入传递，adapter 解析 stream JSON 后交给 core 标准化。

Pi 与 Codex 同样通过 CLI 调用。Codex adapter 保留 CLI 自带的模型提示词，并通过
`--output-schema` 传递最终响应 schema，不再在用户 prompt 中重复该 schema。Pi 默认使用中立的
RoleKit prompt；当最终生效的 model 显式指定 `grok-4.5`（包括带 provider 的完整名称）时，Pi
adapter 会用 `<user_query>` 包裹执行合同，通过 `--append-system-prompt` 追加一小段执行约束，并
默认增加 `--thinking high`。如果最终 model 已带 thinking 后缀，或 `commandArgs`/`extraArgs`
已提供合法的 `--thinking <level>` 参数对，则以显式配置为准。

command、environment、model、timeout 和扩展能力都属于 adapter 的不透明配置。prompt profile
选择完全位于 adapter 内部，不向 core 公共任务契约引入任何模型专属概念。

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

## 扩展 executor

实现 `ExecutorAdapter` 并在构造 `Rolekit` 时注册即可。core 没有按宿主分支的 switch，也不会因为增加第四个
adapter 而修改。

## 边界文档

- [架构](docs/architecture.md)
- [Veritack 集成边界](docs/veritack.md)
- [English README](README.md)
