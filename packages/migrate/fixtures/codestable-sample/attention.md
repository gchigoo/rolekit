# Attention

本文件是 CodeStable 技能启动必读的项目注意事项入口。所有 CodeStable 子技能开始工作前必须读取它。

## 报告语言

CodeStable 所有落盘产出的正文用**中文**：plan / design、plan review / design-review、code review、QA、验收、issue（report / analysis / fix-note）、refactor、roadmap、goal、沉淀（compound）等所有人读报告都用中文表达。机器状态（YAML / JSON / `state.yaml` / frontmatter 字段）保持机读格式不翻译。如需改默认语言，改这一节。

## 项目碎片知识

<!-- cs-note managed: 用 cs-note 维护，新条目按下面分节追加 -->

### 编译与构建

### 运行与本地起服务

### 测试

### 命令与脚本陷阱

### 路径与目录约定

### 环境变量与凭证

- research `chatgpt-codex`：默认读 `%USERPROFILE%\.codex\auth.json`（可用 `ROLEKIT_CHATGPT_AUTH_FILE` 覆盖）；含 ChatGPT 订阅 token，**禁止提交 git / 写入 run 产物 / 粘贴进聊天**。默认模型 `gpt-5.6-sol`；body 不发 `max_tool_calls`。
- research `openai-responses`：仅从进程环境读 `OPENAI_API_KEY`；禁止硬编码与落盘。
- 两 adapter 互不静默降级；缺凭证 → probe 失败 / handoff，不得伪造 live 证据。

### 其他
- npm scope：`@rolekit`（包本地 private，不发布）
- lint/format：Biome（非 ESLint/Prettier）

