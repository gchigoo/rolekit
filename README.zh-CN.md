# RoleKit

宿主无关的编码 Agent 开发控制系统：以生命周期 WorkItem 与机读任务契约为中心，经可替换执行器完成受约束任务，产物落盘在 `.rolekit/`。

[English](./README.md)

## 能做什么

- **WorkItem** — feature / issue / refactor / research / goal，命令驱动状态机
- **Task Contract** — 目标、scope、约束、交付物与验收（不是自由文本 prompt）
- **Run** — 隔离执行；支持 status / steer（Pi）/ cancel / collect / verify
- **Gate** — 机械证据放行 + 少量人工确认白名单
- **Knowledge** — rule / adr / learning / note；active rule 注入下一次 compile
- **Profile** — Role + Executor YAML（Pi、ChatGPT Codex、OpenAI Responses 等）
- **Migrate** — 从 CodeStable / Superpowers 迁入全新 `.rolekit` 根

宿主 Skill（Pi / Cursor / Codex）保持薄：只教 CLI 意图、读密封产物。恢复与 gate 决策不放进 Skill。

## 环境要求

- Node.js `>= 22.18`
- npm（仓库根 workspace）或兼容包管理器
- 可选执行器：Pi（`>=0.80 <0.90`）；研究路径可用 Codex / Responses

## 安装

```bash
git clone https://github.com/gchigoo/rolekit.git
cd rolekit
npm install
npm link ./packages/cli   # 将 rolekit 挂到 PATH
```

安装宿主 Skill（可选）：

```bash
npm run install-skill:cursor
npm run install-skill:pi
npm run install-skill:codex
```

## 快速开始

```bash
rolekit workitem list --json
rolekit task compile path/to/task.yaml --json
rolekit run start path/to/task.yaml --json
rolekit run status <run-id> --json
rolekit run collect <run-id> --json
```

优先加 `--json` 以便机读。完整意图表见 [`adapters/shared/command-map.md`](./adapters/shared/command-map.md)。

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `packages/cli` | `rolekit` 命令行 |
| `packages/core` | schema、compile、knowledge |
| `packages/runner` | run 管理、执行器、verifier |
| `packages/migrate` | 迁入 `.rolekit` 的遗产导入 |
| `packages/evals` | 离线 evaluateRun fixture |
| `profiles/` | 角色 / 执行器 / 片段源 |
| `adapters/` | 薄宿主 Skill + 共享 command-map |
| `.rolekit/` | **唯一**生命周期根（work-items / knowledge / runs / migrations） |

## 运维注意

- `run steer` 返回 **accepted** 只表示 durable control 已受理，不表示 worker 已执行完
- owner/executor **lost** 会关闭当前 run；重试必须是新 attempt / 新 run id
- 勿提交密钥、`auth.json`、原始 campaign dump
- cutover 回执：[`docs/cutover-receipt.md`](./docs/cutover-receipt.md)

## 开发

```bash
npm test
npx tsc --noEmit
npm run evals
npm run lint:adapters
npm run validate:profiles
```

## 状态

RoleKit v2 goal 已完成。唯一生命周期真相根为 `.rolekit/`。

## 许可

`package.json` 标记为 `private: true`。对外分发前请先明确许可证。
