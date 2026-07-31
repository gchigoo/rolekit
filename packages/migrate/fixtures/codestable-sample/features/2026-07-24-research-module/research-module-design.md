---
doc_type: feature-design
feature: 2026-07-24-research-module
requirement: ""
roadmap: rolekit-v2
roadmap_item: research-module
execution_lane: goal
status: approved
summary: RoleKit 原生深度研究模块：本条 live 验收改走 chatgpt-codex（ChatGPT 订阅 auth.json + Codex Responses SSE）；保留 openai-responses（API key）为第二实现；产物冻结 report.md + activity.json，四断言由 check:research 机械判定
tags: [profiles, runner, research, adapter, chatgpt-codex, openai-responses]
---

# research-module design

## 0. 术语约定

| 术语 | 定义 | 防冲突结论 |
|---|---|---|
| Research Brief | kind=research 的 TaskContract 本身（roadmap 条目 6："Research Brief 即 TaskContract"——objective/context/constraints 承载研究任务）| **不新增名词实体**——Brief = 契约，经 compilePrompt 编译为 prompt.md（4.7 编译产物）作为 adapter 输入；三层关系固定为 Brief(TaskContract) → prompt.md → API input |
| OpenAiResponsesExecutor | ExecutorAdapter：经 OpenAI Platform Responses API（`api.openai.com/v1`，`OPENAI_API_KEY`，`background:true` 轮询）执行研究 | 注册表名 `openai-responses`；本条保留实现与单测，**不再作为本条 live 验收硬依赖** |
| ChatgptCodexExecutor | ExecutorAdapter：经 ChatGPT/Codex 订阅未文档端点（`chatgpt.com/backend-api/codex/responses`，SSE）执行研究 | 注册表名 `chatgpt-codex`；**本条 live 验收与 S1 spike 主路径** |
| Codex auth.json | Codex CLI / ChatGPT 登录产物：`auth_mode=chatgpt` + `tokens.access_token/refresh_token/account_id` | 默认 `%USERPROFILE%\.codex\auth.json`，可用 `ROLEKIT_CHATGPT_AUTH_FILE` 覆盖；禁止写入 git / run 产物 / 日志 |
| activity.json | `runs/<id>/artifacts/activity.json`：原始活动记录（tool calls + citation annotations + 响应元数据）| roadmap 条目 6 冻结产物；**非 core schema**——结构断言由 check:research 脚本承载，不进 rolekit validate 类型清单 |
| 引用索引 | report.md 末尾的 citation 定义区，内联编号 → url + title | 格式本 design D5 冻结 |
| check:research | 四条 roadmap 验收断言的机械判定脚本（npm script）| 新词，无冲突 |

TaskContract / ResultEnvelope / RunEvent / ExecutorProfile / RoleProfile 以 roadmap 4.1/4.4/4.7 冻结定义为准，不重抄。

## 1. 决策与约束

**需求摘要**：RoleKit 原生深度研究模块（deepsearch讨论.md 工作流与 pi-web-fetch 检索层均只读参考）：researcher RoleProfile 已由 role-profiles-migration 交付，本条交付 kind=research 契约特化 + 研究执行路线 + 引用绑定产物 + 机械验收脚本。为谁：委派研究类任务的工作流（后续 workitem kind=research 的执行面）。成功标准（roadmap 冻结四断言）：1 次 kind=research 契约 run 后 (1) report.md 与 activity.json 存在且路径出现在 evidence；(2) report.md 每个内联引用编号在引用索引中解析出 url + title；(3) 引用索引与 activity.json 的 citation annotations 一一对应；(4) activity.json 含 ≥1 条检索调用记录且过结构断言。明确不做：意图澄清交互；file_search / vector store；code_interpreter；中途 steering；citation verifier；Pi 会话 + web 工具路线；把 ChatGPT access_token 写入 `OPENAI_API_KEY` 打 `api.openai.com`；托管多租户 / token 池；pi-exa-fetch 代码复用；进度 UI；将 auth.json 或任何 token 提交进 git / 写入 run 产物。

**复杂度档位**：核心基础设施档——双真实远程 ExecutorAdapter 实证 seam 可替换性；订阅路径依赖未公开端点，须 S1 spike 与 owner 风险接受。

**关键决策**：

- D1 执行路线拍板（2026-07-29 改道）：**本条 live 验收主路径 = `chatgpt-codex`**；保留 **`openai-responses`** 为 API-key 第二实现（单测/文档/可选 live）。裁决依据：(a) 四断言 (2)(3) 仍要求可机械解析的 `url_citation` annotations——S1 必须用订阅 auth 实证 Codex 响是否含同等形态；形态不符 → blocking gate，禁止弱化 check:research；(b) owner 无 Platform API key，仅有 ChatGPT 订阅 auth.json；(c) seam 可替换性用两个远程 adapter 名继续实证。代价：依赖未文档 Codex 后端与订阅 ToS（仅本机个人 dogfood；账户封禁/端点变更属 D1 gate，不伪造证据）。**路线 fallback 为 blocking gate**：S1 spike timebox = **3 个工作日**；触发条件（任一）：(a) auth 无效 / refresh 失败 / 订阅端点不可用被确认；(b) annotations 或 web_search_call 形态与 D4 不符且无法机械解析；(c) timebox 到期 spike 未通过。触发后停止 live 验收，改走 Pi 或其它路线须再修订本 design 并重过 design review（禁止静默改道）。
- D2 `openai-responses` 行为冻结（保留）：probe 检查 env `OPENAI_API_KEY`（稳定码 `missing_api_key`）；`POST https://api.openai.com/v1/responses` + `background:true` + 轮询 status/cancel；protocol_version=`responses-v1`；capabilities=`start|status|cancel|collect`；steer → unsupported_operation。模型/settings 默认同前（`gpt-5.6`、reasoning_effort、max_tool_calls、search_context_size、poll_interval_ms）。
- D2b `chatgpt-codex` 行为冻结（本条验收路径）：
  - **probe**：解析 auth 文件（路径 = `ROLEKIT_CHATGPT_AUTH_FILE` 或默认 `~/.codex/auth.json` / Windows `%USERPROFILE%\.codex\auth.json`）；要求 `auth_mode=chatgpt` 且存在可用 `refresh_token` 或未过期 `access_token`；**无上游业务调用**；缺失/不可读/形态非法 → `ExecutorIncompatibleError` 稳定码 `missing_chatgpt_auth`（exit 1，不进 start）。返回 `{ adapter:'chatgpt-codex', protocol_version:'codex-responses-v1', capabilities:['start','status','cancel','collect'] }`。
  - **auth refresh**：access 过期或 401 时，用 refresh_token 调 `https://auth.openai.com/oauth/token`（OAuth client id 与 Codex CLI 一致：`app_EMoamEEZ73f0CkXaXp7hrann`）；成功后写回同一 auth 文件（尽量 `0600`）；失败 → `missing_chatgpt_auth` 或 start/status 失败，不重试无限循环。
  - **start（非阻塞）**：与 openai-responses / RunSupervisor 对齐——`start` **必须在发起上游请求并挂好 session 后立即返回 `RunHandle`**，不得在 `start` 内同步 drain 完整研究。流程：probe 级 auth 解析 → 必要时 refresh → 创建 per-run `AbortController` 写入 session → `POST` SSE（`stream:true`）→ 后台任务 drain 事件并聚合；`start` 返回后 supervisor 才能 cancel/deadline/status。body 遵守订阅约束：`store:false`、**`stream:true`（SSE 必选）**、非空 `instructions`、`input` 为 message 数组（由 prompt.md 包装）、`tools` 含 web_search（字段名 S1 实证）、`model` 默认 **`gpt-5.6-sol`**（ChatGPT 账户 Codex 目录 slug；`gpt-5.6` / `*-codex` 会 400）。**不发送 `max_tool_calls`**（订阅端点返回 `Unsupported parameter: max_tool_calls`）；控费靠 `timeout_minutes` + prompt 约束（spike ≤5 / 验收 ≤20 仍写在 task YAML，仅作软约束）。请求头：`Authorization: Bearer <access_token>`、`ChatGPT-Account-ID`、`OpenAI-Beta: responses=experimental`、`originator: rolekit`、`Content-Type: application/json`。端点：`POST https://chatgpt.com/backend-api/codex/responses`。SSE 聚合：仅 `response.completed|failed|cancelled|incomplete` 为终态（禁止 `endsWith('.completed')`，以免误吃 `web_search_call.completed`）；`response.completed.output` 在订阅端常为空，须从 `response.output_item.done` 聚合 message/web_search_call 再交给 `extractFromResponse`。
  - **SSE→snapshot 形状**：后台 drain 必须聚合成与现有 `extractFromResponse` 兼容的最终 snapshot（Platform Responses 形：`id`/`status`/`model`/`output[]` 含 `web_search_call` 与 message `url_citation`）。事件名/嵌套若不同，adapter 内做规范化映射；聚合后仍无法得到该形 → D1 gate（禁止改 check:research）。
  - **status**：只读本地 session（queued/in_progress/终态与已见 tool ids），不另开 platform GET。
  - **cancel**：abort session 的 `AbortController` 中止 SSE；若上游暴露 cancel 则 best-effort；否则本地 abort + D7a cancelled 行；Envelope 沿用 pi-rpc D10。
  - **collect / timeout**：与 D2/D7/D7a 同语义；timeout → abort 同一 controller + `finished(failed, reason:timeout)`。
  - **refresh 写回**：写临时文件再 rename 覆盖 auth.json；Windows 上权限尽量收紧（无法 POSIX 0600 时记录实现备注，不阻塞）；与 Codex CLI 并发写时以最后成功 rename 为准，refresh 失败不重试死循环。
  - **脱敏**：access_token / refresh_token / id_token / Authorization 头**永不**写入 events、activity.json、report、envelope、spike 证据（证据只保留 redacted 结构样本）。
- D3 事件映射冻结（roadmap 4.4 封闭集合，不新增类型）：新观察到的 `web_search_call` → `tool_call`（每个 call id 恰发一次）；status 变迁 → `message(role:system)`；终态 → `finished`（completed/failed/cancelled/lost 语义同前）。chatgpt-codex 在 SSE 事件中去重，openai-responses 在轮询中去重。
- D4 activity.json 结构冻结：`{ response_id, model, status, tool_calls:[{id,type,query?,status}], annotations:[{type:'url_citation', start_index, end_index, url, title}], usage? }`。断言 (4) = ≥1 条 `web_search_call`。
- D5 report.md 格式冻结：内联 `[^n]` + 索引 `[^n]: [title](url)`；按 annotations 机械注入；index 编码基准由 S1 实证。
- D6 evidence：completed 恰两项相对路径 `artifacts/report.md` + `artifacts/activity.json`；写入主体仍为 ExecutorReport → runner。
- D7 与 run 管线：kind=research 走标准管线不开旁路——隔离 worktree 照建，adapter 不写 worktree（产物落 `runs/<id>/artifacts/`）；`scope.writable=[]`，worktree diff 恒空；verifier 照跑；**check:research 为后置验收**（acceptance.checks / 模板内 no-op command），两 adapter 共用。
- D7a 终态产物表（两 adapter 共用，冻结）：

  | 终态 | report.md | activity.json | ExecutorReport.evidence | verifier | check:research |
  |---|---|---|---|---|---|
  | completed | 生成 | 生成 | 恰两项 | 照跑 | 适用 |
  | failed（API failed/incomplete/lost/timeout）| 不生成 | 以已知信息生成 | 恰一项（activity.json）| 照跑 | 不适用 |
  | cancelled | 不生成 | 以已知信息生成 | 恰一项 | 跳过（pi-rpc D10）| 不适用 |

  职责边界：Envelope.status 的 failed 以 finished/executor 终态为准，不由 verifier 覆盖；`verification.passed=true` ≠ 四断言通过；非 completed → check:research exit 1 `run_not_completed`；activity 最小形 = D4 键集 + null 标量 + 空数组。
- D8 契约模板：`profiles/examples/research-task.yaml` 的 executor 改为 **`chatgpt-codex`**；另保留 `profiles/executors/openai-responses.yaml` 与新增 `profiles/executors/chatgpt-codex.yaml`。
- D9 注册表：登记 `openai-responses` 与 `chatgpt-codex`；各自 probe 失败不静默降级到另一 adapter 或 Pi。

**基线风险**：role-profiles-migration 与 pi-rpc-vertical-slice 严格 done；本机可读 Codex auth.json；owner 已接受订阅/未文档端点 residual risk（确认本改道计划）。

**Top 3 风险与缓解**：
1. Codex 端点/SSE/字段漂移或无 url_citation → S1 最早实证；失败走 D1 gate，不弱化四断言
2. Token 泄露 / ToS → 仅本机 auth 文件；禁止粘贴进聊天/git；脱敏 grep；不托管
3. 计费/配额失控 → chatgpt-codex 靠 timeout + prompt 软约束（端点拒 max_tool_calls）；openai-responses 仍用 max_tool_calls；usage 记入 activity（若响应提供）

**非显然依赖**：可读 ChatGPT auth.json + refresh；`chatgpt.com` / `auth.openai.com` 网络可达；researcher profile；run 管线；verifier-gate 非前置。

**关键假设**：订阅 Codex Responses SSE 对选定模型 + web_search 可用且最终 snapshot 含可解析 `web_search_call` 与 `url_citation`（S1 验证）；单次研究可在 run timeout 内完成 SSE drain。

**必跑验证命令**：`npm test`、`node --test test/e2e/`、`npx tsc --noEmit && npx biome check .`、`npm run check:research -- <runDir>`、`rolekit validate <artifact>`（Windows）。

**交付物清单**：`packages/runner/src/executors/chatgpt-codex.ts`、`chatgpt-auth.ts`、保留 `openai-responses.ts`、注册表、`scripts/check-research.ts`、`profiles/examples/research-task.yaml`、`profiles/executors/{chatgpt-codex,openai-responses}.yaml`、Mock SSE / MockResponses 测试、S1 脱敏 spike、真实验收 run、items/compound/attention 回写。

**清洁度规则**：禁止复制 pi-exa-fetch / deep-research MVP；禁止硬编码或落盘任何 token/API key；禁止调试输出；TODO/FIXME 禁止落盘。

## 2. 名词与编排

### 2.1 名词层

**现状**：runner 已有 ExecutorAdapter seam + pi-rpc / mock / openai-responses；profiles 有 researcher；check:research 与 mock 链路已齐；live 因缺 API key handoff。

**变化**（schema 零改动）：

- `packages/runner/src/executors/chatgpt-codex.ts` + `chatgpt-auth.ts`
- 注册表增加 `chatgpt-codex`
- `profiles/executors/chatgpt-codex.yaml`；`research-task.yaml` executor → chatgpt-codex
- 复用 `openai-responses-artifacts.ts`（SSE 聚合为 snapshot 后 extract）

接口示例：

```ts
// 无 auth 文件：probe 失败
await chatgpt.probe()  // -> ExecutorIncompatibleError('missing_chatgpt_auth')

// 无 API key：openai-responses probe 失败（互不降级）
await openai.probe()   // -> ExecutorIncompatibleError('missing_api_key')

await chatgpt.steer(...)  // -> unsupported_operation
```

**Interface 设计检查**：seam 签名不变；两远程实现证明非假缝；check:research 仍离线可重放。

### 2.2 编排层

**现状**：compile → worktree → adapter.start → 进度 → collect → verifier → Envelope。

**变化**：chatgpt-codex 用**后台** SSE drain（start 立即返回）替代 platform background 轮询；其余管线不变。

**流程级约束**：产物装配在 collect（终态 snapshot → D7a 落 artifacts，早于 verifier）；事件仅状态变迁与新 tool call（D3）；cancel = abort SSE + D7a cancelled + verifier 跳过（D10）；timeout = abort + finished failed/timeout + D7a failed（D7）；evidence 由 ExecutorReport 带回；writable 空 + diff 恒空；check:research 后置。

### 2.3 挂载点清单

1. runner 注册表 `chatgpt-codex` + 保留 `openai-responses`
2. `npm run check:research`
3. `profiles/examples/research-task.yaml` + `profiles/executors/chatgpt-codex.yaml`（+ 保留 openai-responses.yaml）
4. `.codestable/attention.md` 凭证节
5. items.yaml / compound 回写

### 2.4 推进策略

1. S1 spike（订阅 auth，timebox 3 工作日）：最小 SSE round-trip（max_tool_calls≤5，必然检索题）→ 验证 web_search_call + url_citation + index 编码；脱敏证据落盘；失败 → D1 gate
2. ChatgptCodexExecutor + chatgpt-auth（probe/refresh/SSE/cancel/timeout）+ Mock SSE 单测；保留 openai-responses 单测绿
3. 产物装配复用 artifacts helper；research-task 指向 chatgpt-codex；两 profile yaml 过 validate
4. check:research 正负 fixture 保持绿（语义不改）
5. cancel/timeout e2e（mock SSE abort）
6. 真实验收 run（chatgpt-codex）：四断言 + validate + worktree 空 + 脱敏 grep 零命中 token
7. 收口：items.yaml notes（现仍写旧 D1=openai-responses，属过期态）+ compound + attention

### 2.5 结构健康度与微重构

##### 评估
- 文件级：registry / package scripts / attention 小改；新增 chatgpt-*；openai-responses 保留
- 目录级：executors/ 平行新增

##### 结论：不做大重构；artifacts 抽取已存在则复用

##### 超出范围的观察
- 未来若官方支持订阅→Platform 统一鉴权，可再收拢两 adapter——留观察项

## 3. 验收契约

关键场景清单：

1. 真实 chatgpt-codex 研究 run 四断言（S6）
2. S1 spike：订阅响应含检索与 url_citation（D1 gate）
3. chatgpt-codex + openai-responses 状态机/mock 单测
4. probe：`missing_chatgpt_auth` / `missing_api_key` 互不降级
5. steer → unsupported_operation
6. cancel / timeout 路径 + D7a
7. check:research 负例 ≥7 + run_not_completed
8. 样例 yaml 过 validate（research-task + chatgpt-codex + openai-responses）
9. worktree diff 空
10. 脱敏：token/API key 不落盘

明确不做反向核对：无 Pi 研究路线代码；无 token 当 OPENAI_API_KEY；无 auth 入库；无弱化四断言；无新增 RunEvent/core schema。

### 3.x Acceptance Coverage Matrix

| Scenario | Covered By Step | Evidence Type | Command / Action | Core? |
|---|---|---|---|---|
| 真实 chatgpt-codex run 四断言 | S6 | run artifacts + checker | `npm run check:research` | yes |
| spike：订阅 API 形态（D1 gate） | S1 | 脱敏样本 | 真实 SSE round-trip | yes |
| 双 adapter 单测 | S2 | test | `npm test` | yes |
| check:research fixtures | S4 | test | `npm test` | yes |
| cancel 路径（D10 + D7a cancelled） | S5 | test | mock SSE e2e | yes |
| timeout 路径（D7 + D7a failed） | S5 | test | mock SSE e2e | yes |
| probe 缺 auth/key | S2 | test | `npm test` | yes |
| 样例 validate | S3 | command | `rolekit validate` | yes |
| 脱敏 | S6 | command | grep | no |

### 3.y DoD Contract

| ID | 要求 | 证据 | 阻塞级别 |
|---|---|---|---|
| DOD-DESIGN-001 | design 完整且 D1/D2b 改道有裁决依据 | design review | blocking |
| DOD-IMPL-001 | checklist steps 全完成且证据落盘 | checklist / evidence | blocking |
| DOD-REVIEW-001 | code review passed | review report | blocking |
| DOD-QA-001 | QA 覆盖订阅 live run 与负例 | QA report | blocking |
| DOD-ACCEPT-001 | acceptance 回写完成 | acceptance report | blocking |

Validation Commands:

| ID | 命令 | 目的 | 核心性 | 失败处理 |
|---|---|---|---|---|
| CMD-001 | `npm test` | 单测（含 adapter/profile） | core | fix-or-block |
| CMD-002 | `node --test test/e2e/` | CLI e2e | core | fix-or-block |
| CMD-003 | `npx tsc --noEmit && npx biome check .` | 类型与 lint | core | fix-or-block |
| CMD-004 | `npm run check:research -- <runDir>` | research 四断言 | core | fix-or-block |
| CMD-005 | `rolekit validate <artifact>` | profile/run 产物校验 | core | fix-or-block |

Required Artifacts: design-review / review / QA / acceptance、S1 脱敏 spike、chatgpt-codex 真实 run、fixtures、profiles、compound/attention 回写。

## 4. 与项目级架构文档的关系

- 名词：ChatgptCodexExecutor / OpenAiResponsesExecutor / activity.json / check:research → CONTEXT
- D1 改道与订阅 ToS residual risk 记入本 design；不另立 ADR
- 实证结果 → compound；auth 路径 → attention
