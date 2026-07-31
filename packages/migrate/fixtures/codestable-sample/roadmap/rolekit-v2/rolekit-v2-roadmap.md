---
doc_type: roadmap
slug: rolekit-v2
status: completed
created: 2026-07-24
last_reviewed: 2026-07-29
tags: [rolekit, orchestration, contract, executor, migration]
related_requirements: []
related_architecture: []
---

# RoleKit v2：契约中心、执行器可替换的开发控制系统

## 1. 背景

RoleKit 经历三次形态：v0.1 Prompt 驱动角色库（`D:\Personal\pi-delivery-rolekit`，可用但契约是 markdown、executor 锁死 Pi 子进程）、sdk-first 重设计（因过重与钉死 Pi 版本搁置）、`讨论.md` 契约中心提案。2026-07-24 brainstorm（`.codestable/brainstorms/rolekit-v2-direction/`）收敛为：RoleKit v2 = 精简生命周期 + 契约执行层的自有体系，宿主无关（ADR 001），长期替代 CodeStable（ADR 002），默认自动流转（ADR 003），全 TypeScript + TypeBox（ADR 004），YAML 人写 + JSON/JSONL 机器产物（ADR 005）。本 roadmap 把该方向拆解为可独立验证的子 feature 序列。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- 契约协议冻结（10 类：TaskContract / ResultEnvelope / ExecutorReport / RunEvent / GatePolicy / GateRecord / RoleProfile / ExecutorProfile / WorkItem / KnowledgeEntry）
- Runner 与 PiRpcExecutor 垂直链路（隔离 worktree、验证、Envelope 回流）
- CLI 通用表面与三宿主薄适配
- 既有资产吸收：7 角色 profiles 转换、veritack 判据吸收改良为原生 verifier + gate 引擎、参考 deepsearch讨论.md 自研 research 模块
- 精简生命周期核心（WorkItem + 状态机 + lane + 知识两层）
- `rolekit migrate --from codestable|superpowers` 遗产迁移工具
- evals fixture 与 dogfood 硬化收口

### 明确不做

- MCP server（后置：出现真实多客户端需求再包同一 Runner）
- 并行多 writer 编排（Coordinated lane 第一版只做多只读 + 单隔离 writer）
- plugin 打包分发（体系稳定后另立条目）
- 远程 / 多机 executor
- Web UI / dashboard
- 修改 CodeStable / superpowers 本体（只读吸收与迁移）
- 直接依赖或 fork 参考仓库——pi-delivery-rolekit、skeg（veritack）、pi-web-fetch（pi-exa-fetch）、deep-research MVP、deepsearch讨论.md 一律只读参考，吸收其设计后产物必须是 RoleKit 原生配套（owner 原则）
- OS 级 sandbox / 网络硬隔离（第一版为"隔离 worktree + 执行后检测 + 集成前阻断"，见 4.6；真 sandbox 为后续 roadmap）

### Granularity Gate

| 判断项 | 结论 |
|---|---|
| 为什么不是 single feature | 四包 monorepo + 三宿主适配 + 遗产迁移，交付物跨模块且有明确依赖 DAG，多阶段验证（协议→链路→吸收→切换） |
| 为什么不是 brainstorm | 方向已在 brainstorm 收敛并落 5 条 ADR，目标与完成信号明确 |
| roadmap 边界 | 只覆盖上述范围；MCP、plugin、多 writer、OS sandbox 明确不做 |
| 最小闭环 | `pi-rpc-vertical-slice` 完成后，可在真实项目上用一份 TaskContract 端到端跑完"委派→隔离执行→验证→Envelope 回流" |

## 3. 模块拆分（概设）

```
rolekit-v2（本仓库 monorepo）
├── core（packages/core）：契约 schema、WorkItem 状态机、lane 路由、prompt 编译
├── runner（packages/runner）：ExecutorAdapter 接口、PiRpcExecutor、worktree 管理、run 管理、verifier
├── cli（packages/cli）：rolekit CLI——唯一通用表面
├── migrate（packages/migrate）：codestable / superpowers 遗产迁移
├── adapters（adapters/）：各宿主薄入口（pi / codex / cursor）
├── profiles（profiles/）：角色库与 capability packs
└── evals（evals/）：契约 / 越界 / Envelope fixture 与种子场景
```

### 模块 core

- **职责**：TypeBox 定义全部契约 schema 并导出 JSON Schema；PolicyEngine（trigger hits → decisions/overall）；WorkItem 状态机与 lane 路由；prompt 片段编译；Knowledge markdown 的纯 parse/serialize/filter/active-rule 选择与 compilePrompt 可选 rules。不做 I/O 编排、不感知宿主。
- **承载的子 feature**：contract-schemas、verifier-gate-engine（PolicyEngine + gate-record schema）、workitem-lifecycle-core、knowledge-layer（core 部分）
- **触碰的现有代码**：全新；schema 语义参考 sdk-first 备份与讨论.md
- **Depth 判断**：deep——契约复杂度（校验、演进、编译、状态转移、policy 折叠）藏在 core，callers 只见类型与校验函数

### 模块 runner

- **职责**：执行一份 TaskContract：建隔离 worktree、经 ExecutorAdapter 驱动执行器、收集事件流、跑验证、GateEvaluationPipeline（detectors + PolicyEngine）与 RunManager gate coordinator、组装最终 ResultEnvelope 并落盘 run 记录。不决定"该不该委派"（lane 路由归 core，调用归 cli）。
- **承载的子 feature**：pi-rpc-vertical-slice、verifier-gate-engine、research-module（研究执行器路线）、knowledge-layer（read-only catalog load、knowledge snapshot、digest/prompt 接线）
- **触碰的现有代码**：全新；PiRpcExecutor 参考 pi-delivery-rolekit 的 role_agent spawn 经验与 sdk-first 的 RPC 结论；verifier/gate 吸收 veritack 判据设计（只读参考）
- **Depth 判断**：deep——RPC 协议、进程管理、恢复语义藏在 adapter 实现内

### 模块 cli

- **职责**：把 core + runner 暴露为可组合命令；所有宿主与人只经 CLI 交互；`--json` 输出供 agent 消费。
- **承载的子 feature**：contract-schemas（validate 子命令）、pi-rpc-vertical-slice（run 子命令）、verifier-gate-engine（gate list|approve|reject）、workitem-lifecycle-core（workitem 子命令）、knowledge-layer（knowledge store 与 knowledge create|get|search|edit|set-status）
- **触碰的现有代码**：全新
- **Depth 判断**：shallow-by-design——CLI 只做参数解析与出口格式化，逻辑住 core/runner；防止逻辑漏进 CLI 是 review 关注点

### 模块 migrate

- **职责**：审计 `.codestable/` 与 obra superpowers 技能包，生成映射报告，转换为 `.rolekit/` 与 profiles 格式。
- **承载的子 feature**：migrate-tool
- **触碰的现有代码**：只读消费 CodeStable / superpowers 产物
- **Depth 判断**：deep——格式差异与语义映射藏在内部，出口只有"审计报告 + 迁移执行"

### 模块 adapters

- **职责**：每宿主一份薄 Skill / 规则文件，教宿主何时及如何驱动 CLI；不承载任何工作流语义（ADR 001 约束）。
- **承载的子 feature**：host-adapter-skills
- **触碰的现有代码**：pi-delivery-rolekit 的 skills 作参考素材
- **Depth 判断**：刻意 shallow——出现逻辑即违反 ADR 001

### 模块 profiles

- **职责**：RoleProfile / ExecutorProfile YAML 与 prompt 片段；研究等能力模块的 profile 配套。
- **承载的子 feature**：role-profiles-migration、research-module（researcher profile 侧）
- **触碰的现有代码**：pi-delivery-rolekit 7 角色作转换源；deepsearch讨论.md 与 pi-web-fetch 作研究模块参考
- **Depth 判断**：数据为主，深度在 core 的编译器

### 模块 evals

- **职责**：契约完整率、写入越界、Envelope 完整率等机械评测 fixture；种子场景。
- **承载的子 feature**：evals-fixtures、hardening-dogfood-switchover（回归部分）
- **触碰的现有代码**：参考 pi-delivery-rolekit 的 evals.json 与 veritack dogfood 套路
- **Depth 判断**：无跨模块深度诉求

## 4. 模块间接口契约 / 共享协议（架构层详设）

### 4.1 TaskContract schema（core → runner / cli / adapters 共享）

**方向**：core 定义，全体消费。**形式**：TypeBox 类型 + 导出 JSON Schema；人写 YAML，编译为 JSON 落 run 目录。

```
TaskContract {
  schema: 'rolekit/task-contract@1'   // 必填，演进走版本号
  id: string                          // RK-YYYYMMDD-NNN
  kind: 'implementation' | 'research' | 'review' | 'fix'
  role: string                        // RoleProfile 名
  executor: string                    // ExecutorProfile 名
  objective: string
  context: { required_files: string[]; docs: string[] }
  scope: { writable: string[]; forbidden: string[] }   // glob；forbidden 优先
  constraints: string[]
  deliverables: string[]
  acceptance: {
    commands: { run: string; expect_exit: number }[]   // 至少一条
    assertions: string[]
  }
  execution: {
    worktree: 'isolated' | 'in-place'
    max_tool_calls: number
    network: 'deny' | 'allow'         // 第一版为声明 + 事后审计，见 4.6
    timeout_minutes: number           // runner 强制，超时即 cancel 并记 finished(reason:'timeout')
  }
  escalation: {
    on_scope_change: EscalationAction
    on_new_dependency: EscalationAction
    on_ambiguous_requirement: EscalationAction
  }
}
EscalationAction = 'return_blocked' | 'require_approval' | 'return_question'
```

**Interface 设计检查**：core 暴露 `compileTask(yaml) -> TaskContract`（校验失败抛字段级错误）；seam 在校验函数——CLI、迁移、测试全部穿过它；dependency strategy：in-process；adapter：无（纯数据契约）。

**第 10 类根 schema（verifier-gate-engine D6/D9）**：整份 `gates.json` 为 `rolekit/gate-record@1` = `{ schema, records: GateRecord[] }`；GateRecord=`{trigger, action:'observe'|'confirm'|'block', decision:'auto-pass'|'human-required'|'blocked', hit_paths?, evidence?, resolution?, ts}`；ignore 不落盘；仅 confirm/human-required 可挂 resolution=`{result:'approved'|'rejected'|'cancelled',by,reason?,ts}`；实现扩 core registry，不改旧 9 类行为。

### 4.2 ResultEnvelope schema（runner 组装 → 宿主消费）

**方向**：runner 组装（唯一所有者），宿主经 CLI 消费。**形式**：`result.json`。

```
ResultEnvelope {
  schema: 'rolekit/result-envelope@1'
  task_id: string
  status: 'completed' | 'blocked' | 'question' | 'failed' | 'cancelled'
  summary: string
  changed_files: string[]
  verification: { command: string; exit_code: number }[]   // 由 runner 从 VerificationReport 填入
  scope_violations: string[]                               // 非空即 status != completed
  decisions: string[]
  assumptions: string[]
  evidence: string[]              // 相对 run 目录的路径
  risks: string[]
  unresolved: string[]            // status != completed 时非空
  recommended_next_action: string
}
```

**所有权**：executor 经 `collect()` 返回 **ExecutorReport**（见 4.3，不含 verification / scope_violations）；runner 跑 Verifier 后组装最终 Envelope。executor 不得自称验证通过。

### 4.3 ExecutorAdapter 接口（runner 内部 seam，执行器可替换点）

```
interface ExecutorAdapter {
  probe(): Promise<{ adapter: string; protocol_version: string
                   ; capabilities: ('start'|'status'|'steer'|'cancel'|'collect')[] }>
    // 启动前探测；不满足声明的兼容窗口（如 pi-coding-agent >=0.80 <0.90，仿 veritack peerDependencies 方式）
    // 即抛 ExecutorIncompatibleError，不进入 start；宿主经 capabilities 预判可用操作
  start(task: TaskContract, ctx: RunContext): Promise<RunHandle>
    // 幂等键 = task.id + ctx.attempt；同键重复 start 返回既有 RunHandle 不重启进程
  status(runId: string): Promise<RunStatus>
  steer(runId: string, message: string, control: { requestId: string }): Promise<void>
    // control.requestId 必须等于 durable SteeringRequest id；hardening 后 PiRpcExecutor 在 capabilities 声明 steer；Pi RPC success 只表示 accepted/queued。
    // OpenAiResponsesExecutor 仍不声明并抛 ExecutorUnsupportedOperationError。
    // cancel 必须 idempotent/abort-safe；termination CAS后可由RunSupervisor与既有steer promise并发发起，Pi须out-of-band终止owned process而非排队第二条RPC。
  cancel(runId: string): Promise<void>     // 幂等；对已 finished 的 run 为 no-op
  collect(runId: string): Promise<ExecutorReport>
    // 幂等；只读 run 记录，可重复调用
}
RunHandle  = { run_id: string; pid?: number }
RunStatus  = { state: 'running' | 'awaiting-gate' | 'finished'; last_event_ts: string }
RunContext = { worktreePath: string; runDir: string; attempt: number
             ; profile: RoleProfile; policy: GatePolicy }
  // attempt 由 run manager 持久化分配：同一 task 首次启动为 1，每次显式重试 +1（写入 run 记录）；
  // 幂等键 task.id + attempt 因此对重复调用稳定、对显式重试唯一
ExecutorReport = Omit<ResultEnvelope, 'schema' | 'verification' | 'scope_violations'>
             & { schema: 'rolekit/executor-report@1' }
```

RunManager.steer(runId,text,options:{requestId?:string}) 是唯一应用入口；RunSupervisor 独占 live adapter/stdio并唯一发送。
SteeringRequest 先 durable pending 后 send；same id+digest 幂等、异 digest 冲突；active owner loss 不重发同 run，先关闭 pending 再 failed/lost。
首prompt前set_steering_mode失败即incompatible；pending control含queued|inflight dispatch；active退出经RunState.transition_intent pending→ready→committed barrier关闭queued；finalizing收一次inflight，cancelling则立即stop并与原response竞速；非active不得补造accepted event。

**错误模型**：`ExecutorIncompatibleError` / `ExecutorStartError` / `ExecutorLostError`（进程消失或 RPC 断连）/ `ExecutorTimeoutError` / `ExecutorUnsupportedOperationError`（capabilities 未声明的操作）。runner 捕获前四类后统一落 `finished` 事件（带 reason）并组装 `status: 'failed'` 的 Envelope；`ExecutorUnsupportedOperationError` 不落 finished，由 CLI 转 exit 1 + `--json` 输出 `{ "error": "unsupported_operation" }`。不静默吞错。hardening 追加稳定码：`run_not_steerable|executor_lost|steer_request_conflict|steer_message_invalid|steer_rejected|steer_wait_timeout|steer_response_timeout`。pi-rpc：steer 已落地；same-run reconnect 仍不支持，lost 经新 attempt。

**Interface 设计检查**：执行器可替换性的唯一 seam；dependency strategy：local-substitutable；adapters：PiRpcExecutor（生产）+ MockExecutor（测试）两个，非假 seam；Pi RPC 细节（JSONL、request id、session、版本探测）全部藏在 PiRpcExecutor 内。

**RunManager 应用面与控制协议（pi-rpc-vertical-slice D15）**：ExecutorAdapter五方法不变；RunManager完整API（ensureAuditEvent仅lane-override/observe gate）+loaders；ManagedRunStatus.last_event_ts=string|null；RunContext由snapshots重建；adapter附属executor-control协议={deterministic token,intent→started,pid/session receipt}，RunManager写intent/commands，RunSupervisor独占adapter与stdio、adapter回receipt，双层跨进程幂等。

### 4.4 RunEvent 流（executor → run 记录）

**形式**：`events.jsonl` 逐行 JSON，追加写、不可变。

```
RunEvent = { schema: 'rolekit/run-event@1'; ts: ISO8601; run_id: string } & (
  | { type: 'started';      payload: { task_id: string; adapter: string; worktree: string } }
  | { type: 'tool_call';    payload: { name: string; args_digest: string } }
  | { type: 'message';      payload: { role: 'worker'|'system'; text: string } }
  | { type: 'gate';         payload: { gate: string; action: 'ignore'|'observe'|'confirm'|'block';
                                       decision: 'auto-pass'|'human-required'|'blocked'; evidence: string } }
  | { type: 'verification'; payload: { command: string; exit_code: number } }
  | { type: 'escalation';   payload: { rule: keyof TaskContract['escalation']; action: EscalationAction; detail: string } }
  | { type: 'finished';     payload: { status: ResultEnvelope['status']; reason: string | null } }
)
```

`gate` 事件是 ADR 003 自动放行的审计基础。事件类型集合对全部 executor 封闭：research-module 的研究进度同样映射到既有类型（检索/文件调用 → `tool_call`，状态轮询摘要 → `message(role:'system')`，完成 → `finished`），不新增事件类型。

### 4.5 CLI 命令面（宿主 adapters → cli）

```
rolekit run start <task.json> [--detach] [--retry] [--json]
rolekit run status <run-id> [--json]
rolekit run steer <run-id> --message <text> [--request-id <id>] [--json]
rolekit run cancel|collect <run-id> [--json]
rolekit gate list|approve|reject <id> [--reason <text>] [--json]
rolekit workitem create|list|next|design|start|done|drop|resume <...> [--json]
rolekit knowledge create|get|search|edit|set-status <...> [--json]
rolekit migrate --from <codestable|superpowers> [--source <path>] [--target <project-root>] [--decisions <yaml>] [--report-dir <path>] [--audit-only] [--json]
rolekit validate <file> [--json]
rolekit task create|compile <yaml> [--json]
rolekit verify <run-id> [--json]
```

追加：“steer success=`{id,state:<run-state>,steer:{state:'accepted',request_id,no_op}}`；accepted≠executed。drop=`workitem drop <id>`；resume=`workitem resume <id> --to <planned|designing|executing>`。exit 0/1/2 与 ErrorCatalog；所有宿主只消费该表。”

**约束**：exit 0 成功、1 校验/业务失败（含非法状态转移）、2 用法错误；`--json` 时 stdout 只有 JSON。宿主 Skill 只允许调用本命令面（ADR 001）。无 audit-only 即 apply；codestable source 默认 `<cwd>/.codestable`，superpowers 必须显式 source，target 默认 cwd。成功 JSON=`{migration:{id,from,mode,status,source_manifest_sha256,target?,report:{base,path},counts,no_op}}`；report/target 三态按D2a，均不落绝对路径；错误=`{error,migration_id?,report?:{base,path},detail?,issues?}`；exit 0/1/2。稳定码为 `migration_source_not_found|migration_source_unsafe|migration_path_overlap|migration_source_version_unsupported|migration_license_invalid|migration_status_missing|migration_status_unknown|migration_type_missing|migration_merge_conflict|migration_dependency_invalid|migration_skip_invalid|migration_target_exists|migration_lock_held|migration_source_changed|migration_validation_failed|migration_semantic_fidelity_failed|migration_staging_conflict|migration_promote_failed|migration_io_failed|usage_error`。

**knowledge 出口**：成功 shape 为 `{entry:{frontmatter,body}}` 或 `{entries:[{frontmatter,body}]}`；业务/用法错误均 `{error,id?,detail?,issues?}`，exit 分别 0/1/2；稳定码为 `knowledge_not_found|knowledge_exists|knowledge_invalid|knowledge_id_mismatch|knowledge_input_read_failed|knowledge_io_failed|lock_held|usage_error`。

**run/verify 语义（pi-rpc-vertical-slice D15）**：`run start <task> [--detach] [--retry]`；verify从baseline+冻结patch重建audit worktree、不碰主区、不覆写原证据，写reverify artifact；cancelled/源不可用→run_not_verifiable；所有run子命令经RunManager。

**gate `<id>`（verifier D5 + workitem D3）**：大小写敏感前缀路由——`run-` → RunManager gate handler（shape `{id,state,phase,pending}`）；`WI-` → workitem handler（shape `{id,status,gate}` / `{id,status,decision,no_op}`）；其他（含小写 `wi-`）→`invalid_gate_target` exit2。WI 稳定错误码：`workitem_not_found|no_pending_gate|gate_decision_conflict|invalid_workitem`；run 码不变。resolved 同决策 no-op exit0，相反决策 `gate_decision_conflict` exit1。

### 4.6 GatePolicy 与 Verifier（core 定义，runner 执行）

**形式**：`policies/gates.yaml`（人写）+ verifier 接口。

```
GatePolicy {
  schema: 'rolekit/gate-policy@1'
  default_action: 'ignore' | 'observe'          # ADR 003 默认放行档
  triggers:                                     # trigger -> action，最具体者胜；
    new-dependency:    'confirm'                # 冲突时 block > confirm > observe > ignore
    migration:         'block'
    public-api-change: 'confirm'
    delete:            'confirm'
    scope-violation:   'block'
    ambiguous-requirement: 'confirm'
    design-artifact:   'confirm'
    final-acceptance:  'confirm'
}
// action 语义：ignore 不记录；observe 记 gate 事件自动过；confirm 人工 gate；block 硬阻断
interface Verifier {
  verify(runDir: string, task: TaskContract): Promise<VerificationReport>
}
VerificationReport = { passed: boolean; results: { command: string; exit_code: number }[]
                     ; scope_violations: string[] }
PolicyEvaluation = { decisions: { trigger; action; reason }[]; overall: GateAction }
// evaluate(hits, policy)：decisions 与 hits 一一对应（含 ignore）；overall 按
// block > confirm > observe > ignore 唯一折叠；未知 trigger 走 default_action
```

**scope 机械硬失败（verifier-gate-engine D4）**：`verification.passed=false` 且 `scope_violations` 非空时不调用 PolicyEngine，固定 mechanical-scope-block（Envelope failed，gates 一条 block record）；人工 gate 不可洗成成功。`scope-violation` 触发器强制 `block`（policy_invalid 否则）。

**两层 seam（替换原“双 Verifier adapter”措辞）**：`Verifier.verify()→VerificationReport`（MinimalVerifier 保留）+ `GateEvaluationPipeline`（detectors + core PolicyEngine，无 run 产物写/状态迁移）+ RunManager coordinator（唯一写 gates/events/result/run-state）。`rolekit.yaml` `verifier:minimal|enhanced`：enhanced 默认启用 detect snapshot + change-manifest + pipeline。

**越界与网络的第一版执行机制（诚实边界）**：

- 写入圈禁靠**隔离 worktree 作默认工作目录**——这是目录隔离不是强制隔离：worker 进程仍可经绝对路径 / `..` / shell `cd` 触及主工作区，第一版不提供 OS 级防护
- `scope.forbidden` / `writable` 靠**执行后检测 + 集成前阻断**：verifier 对 worktree diff 做 glob 匹配，违规文件列入 `scope_violations`，Envelope 判 failed，该 worktree 不集成、丢弃；prompt 中的 scope 约束仅为 advisory 第一道
- **主工作区基线检查（best-effort）**：run 前后对主工作区做快照哈希对比，run 期间主区出现变更即 fail-safe 判 failed；报告措辞为"检测到并发变更"并单列 `concurrent-change` 类别，不断言由 worker 产生（owner 或其他进程的并发修改同样触发，属检测不防护；MinimalVerifier 职责，垂直链路验收覆盖）
- `network: deny` 第一版是**执行器配置声明 + 事后审计**（Pi 会话工具配置 + events 审计），不是网络 sandbox——列入残余风险，验收与产品说明不得称"网络阻断"
- 综合承诺口径：第一版能验收的是"隔离 worktree 内的越 scope 变更不被集成 + 主工作区变更可被检测"，不是 sandbox
- 无法机械化的判据必须归入 confirm/block 人工 gate，不得静默自动过

**veritack 处置：吸收改良，不集成（owner 已拍板，ADR 006）**：`@veritack/pi-veritack@1.3.1` 公开 exports 只有 `./provider-api`，核心原语未导出且禁止深导入 `src/*`——但方向决策已由 owner 定为**吸收 + 改良**：`verifier-gate-engine` 不依赖 veritack 包、不 fork，只读参考其判据设计（Run/Context/Check/Gate/Record 五原语、TriggerPolicy 的 ignore/observe/confirm/block 语义、revision 闭合、证据记账），改良为 RoleKit 原生 verifier + gate 引擎。design 阶段产出**吸收清单**（借什么 / 不借什么 / 改良点，属 ADR 003 设计类人工 gate）。垂直链路不依赖本条——MinimalVerifier（命令 exit code + scope diff + 主区基线检查）是第一版判据，本条在其上强化。

**Interface 设计检查**：Verifier 与 GateEvaluationPipeline 为相邻 local-substitutable seam；PolicyEngine 在 core，runner/WorkItem 双消费且不得再实现优先级折叠。

**终态组装顺序（pi-rpc-vertical-slice D15 + verifier D4/D13）**：非 completed report直终态→机械 verify/scope（scope 不经 PE）→GateEvaluationPipeline→freeze candidate/patch→awaiting-confirm 或 IntegrationManager；scope不可配置弱化；report前cancel固定空verification+空gates、gate-pending cancel保留verification/candidate并将pending全cancelled；GateContinuation=minimal|ignore|observe|all-confirm-approved；passed+continuation+binary integration success才completed；non-scope overall block/reject→Envelope blocked。

### 4.7 RoleProfile / ExecutorProfile（profiles → core 编译器）

```
RoleProfile {
  schema: 'rolekit/role-profile@1'
  name: string; capabilities: string[]; boundaries: string[]
  deliverables: string[]; verification: string[]
  prompt_fragments: string[]      # 相对 profiles/ 的 md 片段路径
}
ExecutorProfile { schema: 'rolekit/executor-profile@1'
                ; name: string; adapter: string; model?: string; settings?: object }
                  // adapter 为注册表校验：schema 只约束非空字符串，取值合法性由 runner
                  // 持有的 adapter 注册表判定（内置 'pi-rpc'|'mock'；research-module 若走
                  // openai-responses 路线注册 'openai-responses'，无需改 schema）；
                  // 未注册名 runner 抛 UnknownAdapterError，CLI 仅透传为 unknown_adapter 错误（exit 1）
```

**约束**：最终 Worker Prompt = 基础安全策略 + RoleProfile 片段 + TaskContract + scope/acceptance/输出 schema + escalation 规则，由 core 编译并存 `runs/<id>/prompt.md`。`PromptRule={id,title,body}`；`compilePrompt(profile,task,policy,options?:{rules?:PromptRule[]})`；rules 空时保持既有五段字节，非空顺序为 safety→rules→role→task→acceptance→escalation，rules 段固定声明不得覆盖 safety；runner 只把 active rule 投影为 PromptRule。

### 4.8 共享状态：`.rolekit/` 目录布局

```
.rolekit/
├── rolekit.yaml                # 项目配置
├── profiles/  policies/        # 人写 YAML
├── integration.lock            # IntegrationManager 主区落地互斥
├── worktrees/<run-id>/         # 隔离 worktree
├── work-items/<id>.yaml        # workitem-lifecycle-core 引入
├── knowledge/.lock             # knowledge-layer 全目录排他锁
├── knowledge/<safe-id>.md      # knowledge-layer 引入（KnowledgeEntry，见 4.10）
├── runs/.allocation.lock
├── runs/.index/<task-hash>/{.lock,attempt-n.json}
└── runs/<run-id>/
    ├── .lock  .supervisor.lock  run-state.json  baseline.json
    ├── policy-snapshot.json  detect-snapshot.json  # detect：enhanced 必有
    ├── profile-snapshot.json  executor-profile-snapshot.json
    ├── knowledge-snapshot.json # knowledge-layer：prepare 必写（空 rules 也写），冻结
    ├── task.json  prompt.md  events.jsonl  gates.json
    ├── result.json  verification.json
    └── artifacts/
        ├── executor-control.json  supervisor.json  executor-report.json
        ├── change-manifest.json    # enhanced only；HEAD+untracked 不可变
        ├── integration.patch  candidate.json
        ├── integration-plan.json  integration-result.json
        └── reverify-*.json
```

```
<target>/.rolekit-migrate.lock                    # sibling单写锁，短暂
<target>/.rolekit.migrate-<id>.tmp/               # 完整候选树，短暂
<target>/.rolekit-migration-audits/<id>/          # audit-only报告，不是正式target
.rolekit/migrations/<id>/
  report.json  report.md  source-manifest.json  mapping.json
  semantic-diff.json  error-details.json  target-manifest.json  receipt.json
  licenses/superpowers-MIT.txt                    # 仅superpowers
```

`.rolekit/runs/<run-id>/control/steer/<request-id>.json` — pending(queued|inflight)→accepted|failed，受限可变
`.rolekit/runs/<run-id>/run-state.json` — 增 `transition_intent|null={barrier_id,from:active,to:finalizing|cancelling,state:pending|ready|committed,requested_at,steer_request_ids,resolutions_sha256,target_commit_sha256,cancel_intent,committed_at}`
`<canonical>/dogfood/{plan.yaml,runtime/**}` — owner冻结plan与runtime overlay bundle
`<campaign-root>/plan.yaml` — canonical plan冻结副本，含project相对map
`<campaign-root>/projects/{rolekit-self,ctxline}/` — 两个独立snapshot
`<campaign-root>/.rolekit/dogfood/campaigns/<id>/` — raw started/resolved/hold/ledger/metrics/research-checks/live-evidence/bootstrap-log
`<rolekit-self>/dogfood/campaign-input/<id>/` — RK-07脱敏输入local commit，promotion排除
`<canonical>/dogfood/reports/<id>/{campaign-evaluation.json,ledger-summary.json,metrics.json,campaign-artifacts.json,switch-decision.json,switch-decision.md}`

可变性全文追加：steer control 是 run-state/gate resolution 之外第三个受限控制点；supervisor success 时先写 accepted digest event 再写 accepted control；coordinator 只可据既有 event 补 control，不得在 terminal 后补造 accepted event。terminal前必须关闭全部pending。run-state transition_intent仅active可由null→pending或按D3a一次finalizing→cancelling CAS重写，pending→ready，ready与目标phase同原子committed；离开目标phase时清null；termination_intent仅该cancelling phase commit时投影 `{status,reason}`，requested_at不复制，禁止提前写phase。raw campaign/bootstrap-log 不入 git；project map/run refs仅相对campaign-root，提交报告只含相对引用/digest。runtime strict bundle 以B0 canonical manifest绑定进程参数overlaySourceRoot，绝对根不落盘；两project精确复制config/policy/四role+fragments/Pi executor，rolekit-self另复制canonical `chatgpt-codex`+`openai-responses` 双 research executor；RK-06 live 主路径 `chatgpt-codex` 的 auth 文件只读进程路径/默认 `~/.codex/auth.json` 且 token 不落盘，缺失hold、不得降级Pi或静默改 openai-responses；可选 openai-responses 才读 `OPENAI_API_KEY`（不落盘）；self migration base 先验完并冻结，overlay 不覆盖其 manifest 路径，ctxline 不伪造 migration。

**约束**：机器产物只写 JSON/JSONL（ADR 005）；runs 记录不可变，重跑生成新 run-id；`work-items/*.yaml` 单写者 = CLI 进程（`.rolekit/work-items/.lock`，`wx` + stale pid 清理一次），create 在全局锁内分配 `WI-YYYYMMDD-NNN`；候选校验后同目录 rename 原子替换；锁冲突 `lock_held` exit 1。v1 只向 fresh target 提升；不同 `.rolekit` 已存在即失败，同 receipt/fingerprint 重跑 no-op。候选内所有 schema/graph/fidelity 与 source-after 全过后，same-volume directory rename 是唯一 commit；失败正式 `.rolekit` 不出现。report.md 与第三方 license 是人读/法律证据，其他 migration 机器记录为 JSON；migrate 不生成未冻结的 rolekit.yaml/policy。

**控制证据与可变性（pi-rpc-vertical-slice D15 + verifier D7）**：`.rolekit/integration.lock`、`worktrees/<run-id>`、`runs/.allocation.lock`、`runs/.index/<task-hash>/{.lock,attempt-n.json}`；每run增`.lock/.supervisor.lock/run-state.json/baseline.json/policy-snapshot.json/profile-snapshot.json/executor-profile-snapshot.json`，run-state冻结verifier_mode；enhanced必有detect-snapshot.json，minimal无；artifacts含executor-control.json/supervisor.json/executor-report.json/change-manifest.json（enhanced，不可变）/integration.patch/candidate.json/integration-plan.json/integration-result.json；五核心文件不变；gates.json 为第 6 件产物（根 schema），confirm resolution 为受限就地更新、finished 后冻结。RunPhase封闭九值preparing/prepared/starting/active/finalizing/cancelling/gate-pending/resuming/terminal及phase→state表；run-state含deadline/intent；supervisor生命周期lock+ack；events追加；executor-control仅intent→started；finalizing不可cancel；其余snapshot/baseline/result/verification/change-manifest冻结；prepared可回收、terminal reservation留历史。

### 4.9 WorkItem 模型 / 状态机 / lane 路由（core，跨 workitem-lifecycle-core 与 migrate-tool 共用）

```
WorkItem {
  schema: 'rolekit/work-item@1'
  id: string                     # WI-YYYYMMDD-NNN
  kind: 'feature' | 'issue' | 'refactor' | 'research' | 'goal'
    # goal = 多 item 的大目标容器（承接 CodeStable goals/roadmap 迁移）
  title: string
  status: WorkItemStatus
  gate: { trigger: string; origin: GateOrigin } | null
    # 条件约束：status = awaiting-gate 时必非空，其余状态必为 null（schema 条件校验）
  gate_log: { trigger: string; action: 'ignore'|'observe'|'confirm'|'block'
            ; decision: 'auto-pass'|'approved'|'rejected'|'blocked'; ts: ISO8601
            ; recovery_runs_count?: number }[]
    # recovery_runs_count 必须为非负整数，且仅 trigger=recovery-cycle/action=observe/decision=auto-pass 时必填，其他条目禁止
    # WorkItem 级 gate 审计，独立于 RunEvent（run 存在时另记 run gate 事件）
  lane: 'direct' | 'delegated' | 'coordinated' | null
  lane_reason: string | null                    # selectLane 产出的理由，持久化于此
  lane_overrides: { by: string; from: string; to: string; reason: string; ts: ISO8601 }[]
    # 宿主/owner 覆盖 lane 的审计记录（不依赖 run_id，独立于 RunEvent）
  depends_on: string[]
  runs: string[]                 # 关联 run-id
  created: ISO8601; updated: ISO8601
}
WorkItemStatus = 'planned' | 'designing' | 'awaiting-gate' | 'executing'
               | 'verifying' | 'done' | 'dropped' | 'blocked'
GateOrigin     = 'designing' | 'executing' | 'verifying'   # 收窄：只有这三态可进 gate

合法转移（其余组合 = InvalidTransition，CLI exit 1）：
planned       -> designing | executing | dropped
designing     -> awaiting-gate(origin=designing) | executing | blocked | dropped
executing     -> awaiting-gate(origin=executing) | verifying | blocked
verifying     -> awaiting-gate(origin=verifying) | done | executing | blocked
                 # 验证失败回 executing 重跑；done 仅当 final-acceptance gate 为 observe/ignore 档
awaiting-gate -> {origin} | blocked | dropped
                 # 放行恢复到 origin；特例：origin=verifying 且 trigger=final-acceptance 放行 -> done
blocked       -> planned | designing | executing | dropped

goal 完成不变量：kind = goal 的 WorkItem 转 done 前置条件为 depends_on 中所有未 dropped
项均已 done；不满足即 InvalidTransition（CLI exit 1）。

命令语义：`rolekit workitem done <id>` 按 GatePolicy 的 final-acceptance action 分派（唯一预期，测试可断言）：
- ignore  -> verifying 直接转 done，不生成 gate 字段、不记 gate_log
- observe -> verifying 直接转 done，追加 gate_log(action=observe, decision=auto-pass)
- confirm -> verifying -> awaiting-gate(final-acceptance)；owner 放行 -> done（gate_log decision=approved），
             拒绝 -> blocked（decision=rejected）
- block   -> verifying -> blocked，追加 gate_log(action=block, decision=blocked)

**D4 自动过桥**：`done` 对 executing 先机械过桥到 verifying——delegated/coordinated 要求 runs 均非 running/awaiting-gate 且最新 Envelope `completed`；direct 仅首次且 runs 空；否则 `runs_incomplete`。

hardening D4/D4a：workitem drop 承载 planned|designing|awaiting-gate|blocked→dropped；pending drop按当前gate追加action=confirm/decision=rejected并清gate。workitem resume 承载 blocked→planned|designing|executing 与 verifying→executing，并追加带recovery_runs_count=当前runs.length的recovery-cycle observe marker；executing|verifying且runs.length等于最新marker count时，done先于过桥零写recovery_in_progress；append run后恢复。start 分派优先级：A migrated-unclaimed（executing,lane=null,runs=[]）；B 最新recovery marker有效时新task.id/prepare retry=false；C 其余既有 existing-run truth table。question 唯一触发点=collect→adopt CAS：trigger固定ambiguous-requirement。错误追加 workitem_awaiting_gate|question_unanswered|recovery_task_required|recovery_task_reused|recovery_in_progress。recovery-cycle 是 observe audit marker，不计人工 gate。

**start saga（workitem D2）**：existing-run 按 phase 无 loader 恢复；new/retry = policy→D5/lane→条件 loadRunInput→prepare→link(attachRun)→ensureAuditEvent(lane-override)→startPrepared→waitUntilSettled→adopt CAS（revision+latestRunId）。retry 禁止伪造 executing self-loop；D13：completed→verifying；blocked→WI blocked；failed/cancelled/question 留 executing 待修订 task。

selectLane(item: WorkItem, policy: GatePolicy, signals: LaneSignals) -> { lane; reason: string }
LaneSignals = { estimated_files: number; cross_module: boolean; migration: boolean
              ; context_already_loaded: boolean }
// v1 阈值（D7）：migration||cross_module -> coordinated；estimated_files<=3 && context_already_loaded -> direct；其余 delegated。
// policy 参数保留但不参与结果；lane/lane_reason 写回；覆盖追加 lane_overrides；
// 已有历史 run 时仅 delegated↔coordinated，新 run 镜像 observe gate 事件（非 PolicyEngine 命中）。
```

CodeStable 裁剪细目见 workitem-lifecycle-core design §1a 盘点清单（留/砍/改）；schema、状态转移表与 lane 契约为本 roadmap 冻结的硬约束。migrate 构造 WorkItem 时，bound roadmap item lifecycle status 为首 authority；其余按 goal/roadmap 状态或 CodeStable 已提交阶段解析，document draft/approved 不冒充 lifecycle。状态只用 item10 精确表；未知=`migration_status_unknown`、缺失=`migration_status_missing`。新 WI 固定 gate=null、gate_log=[]、lane/lane_reason=null、lane_overrides/runs=[]；migrate 对 depends_on 做存在/self/cycle 与 goal done invariant 全图校验。MigrationPlan 只有 logical target_key，apply 的 MaterializationPlan 才按日分配 WI ID；audit target_id 恒 null。旧 design/review/checklist support 不复制进 target，只参与 stage/provenance；语义保真不承诺把 prose 写入无 body 的 WorkItem。

### 4.10 KnowledgeEntry（core 定义，knowledge-layer 与 migrate-tool 共用目标格式）

**形式**：`.rolekit/knowledge/<id>.md`——markdown 正文 + YAML frontmatter（frontmatter 机读、可校验，符合 ADR 005 人写层约定）。

```
KnowledgeEntry (frontmatter) {
  schema: 'rolekit/knowledge-entry@1'
  id: string                    # KN-YYYYMMDD-NNN；migrate 统一新分配，源 id/path 进 source/report，禁止碰撞猜测
  type: 'rule' | 'adr' | 'learning' | 'note'
    # rule     = attention 式短规则，prompt 编译收集注入（正文即规则文本，要求单段）
    # adr      = 结构性决策，正文必须含 Nygard 四节标题（Context/Decision/Consequences/
    #            Alternatives Considered，validate 做标题存在性机械校验）
    # learning = 坑与经验（承接 compound 迁移）
    # note     = 其他沉淀
  title: string
  status: 'active' | 'superseded' | 'deprecated'
  tags: string[]
  created: ISO8601
  source: string | null         # 迁移来源路径（手写条目为 null）
}
```

**约束**：`rolekit validate` 支持对 knowledge 条目做 frontmatter schema 校验 + type 特定断言（adr 四节标题、rule 单段）；prompt 编译只收集 `type=rule` 且 `status=active` 的条目。这是 migrate-tool 中 adrs / compound / attention 三类必迁实体的冻结目标格式。filter 的 type/status/tags 多条件 AND，重复 tags 亦 AND，大小写敏感，结果按 id 升序；filename=`<safe-id>.md`，safe-id=`^[A-Za-z0-9][A-Za-z0-9._-]*$` 且不含 `..`，frontmatter.id 必须等于 filename id；prompt 只注入 `type=rule && status=active`；v1 无 WorkItem FK/状态联动。knowledge feature 安装后 prepare 必写一次并冻结 `knowledge-snapshot.json`（空 rules 也写），它属于控制证据，不改变五件核心验收口径。

**迁移映射（冻结，migrate-tool 消费）**：ADR 状态 accepted/proposed → active（proposed 加 tag `proposed` 保留源语义）、superseded → superseded、deprecated → deprecated；compound 条目按源 doc_type 机械分派：learning / pitfall / trick → `type=learning`，其余（explore / spike / question 等）→ `type=note`，源 doc_type 落 tags 保留。migrate 的 compound 必须有 doc_type；learning/pitfall/trick→learning，explore/spike/question/research/note/knowledge→note，缺/空=`migration_type_missing`、其他值=`migration_semantic_fidelity_failed`。attention 仅真实H2起section，忽略H1 preamble/HTML comment、H3归最近H2；有list则逐顶层item、否则逐paragraph，续行折叠为空格，每条必须单段；空section不成entity。ADR/compound/attention 的 source 为 POSIX 相对路径并统一经 knowledge codec+validate；ADR/compound title取trim frontmatter.title、created取created/date/文件日期的冻结优先级，attention title=<H2> #<1-based ordinal>且created=project_epoch、tags按heading链冻结，重复H2失败；compound/attention status固定active；Superpowers note title/adapter epoch与六句迁移说明按migrate design冻结。旧保留源 id 口径同时废止。

## 5. 子 feature 清单

1. **contract-schemas** — TypeBox 定义 9 类 schema（TaskContract / ResultEnvelope / ExecutorReport / RunEvent / GatePolicy / RoleProfile / ExecutorProfile / WorkItem / KnowledgeEntry，见 4.1-4.10），导出 JSON Schema；`rolekit validate` 对每类 schema 至少 1 正例 + 2 负例 fixture 全部判定正确
   - 所属模块：core + cli；依赖：无；状态：done
2. **pi-rpc-vertical-slice** — PiRpcExecutor（capabilities 声明 start/status/cancel/collect，steer 不声明、调用返回 unsupported_operation）+ 隔离 worktree + MinimalVerifier（命令 exit code + scope diff + 主工作区基线检查）+ `rolekit run` 命令 + runs 落盘；阶段化验收四点：(1) MockExecutor 全链路单测过；(2) Pi RPC smoke（probe + 最小 prompt 往返）；(3) 越界写入被 scope diff 拦截、主工作区注入变更被基线检查捕获，两者 Envelope 均判 failed；(4) 真实 dogfood 项目同一契约连续 2 次成功 run + 1 次人工 cancel 场景，五件产物齐全
   - 所属模块：runner + cli；依赖：contract-schemas（消费全部 schema 与 compileTask）；状态：done
3. **host-adapter-skills** — pi / codex / cursor 三份薄 Skill 入口；至少 2 宿主各完成 ≥1 次经 Skill 驱动 CLI 的委派 run
   - 所属模块：adapters；依赖：pi-rpc-vertical-slice（需要可用的 run 命令面）；状态：done
4. **role-profiles-migration** — pi-delivery-rolekit 7 角色转 RoleProfile YAML + prompt 片段：7 份全部通过 schema 校验并可编译出 prompt.md；其中 implementer / reviewer / researcher 3 份各完成 ≥1 次真实链路 run
   - 所属模块：profiles + core；依赖：pi-rpc-vertical-slice（真实 run 验收需要链路）；状态：done
5. **verifier-gate-engine** — 吸收 veritack 判据设计（Run/Context/Check/Gate/Record 五原语、TriggerPolicy 四级语义、revision 闭合、证据记账）改良为 RoleKit 原生 verifier + gate 引擎（含 GatePolicy trigger→action 引擎），不依赖 veritack 包、不 fork（ADR 006）；design 阶段产出吸收清单（借/不借/改良点，owner 过目）；验收：1 次合规 run 全程 0 人工 gate（events 含 observe 记录），1 次注入越界写入的 run 在集成前被 block
   - 所属模块：core + runner + cli；依赖：pi-rpc-vertical-slice（在真实链路上验证 gate 行为，且在 MinimalVerifier 之上强化）；状态：planned
6. **research-module** — RoleKit 原生深度研究模块（参考 `deepsearch讨论.md` 工作流与 pi-web-fetch 检索层，均只读参考）：researcher RoleProfile + `kind=research` 契约特化（Research Brief 即 TaskContract、报告 + 引用即 Envelope + evidence）+ 研究执行路线（openai-responses 后台 ExecutorAdapter 或 Pi 会话 + web 工具，design 阶段定，含进度事件 / 取消 / citation 解析）。**契约衔接冻结（不新增 schema）**：进度复用既有 RunEvent 类型（见 4.4）；adapter 名走 4.7 注册表；产物固定为 `runs/<id>/artifacts/report.md`（报告）与 `runs/<id>/artifacts/activity.json`（原始活动与 citation annotations），`result.json.evidence` 含且仅以相对路径引用二者，citation 数据留在报告内联与 activity.json，不进 Envelope 字段。验收（断言脚本机械判定）：1 次 kind=research 契约 run 后，(1) 两产物存在且路径出现在 evidence；(2) report.md 每个内联引用编号在引用索引中解析出 url + title；(3) 引用索引与 activity.json 的 citation annotations 一一对应；(4) activity.json 含 ≥1 条检索调用记录且通过结构断言
   - 所属模块：profiles + runner；依赖：role-profiles-migration（需要 researcher profile 机制与链路）；状态：planned
7. **evals-fixtures** — 契约完整率 / 写入越界率 / Envelope 完整率 fixture；`npm run evals` 一键回归；种子场景取自垂直链路验收 run 的真实产物
   - 所属模块：evals；依赖：pi-rpc-vertical-slice（需要真实 run 产物作种子）；状态：planned
8. **workitem-lifecycle-core** — 按 4.9 冻结契约实现 WorkItem + 状态机 + lane 路由 + `rolekit workitem` 命令；design 阶段先产出 CodeStable 机制盘点清单（留/砍/改三列，owner 过目）；验收：create→next→start（委派一次真实 run）→done 全程命令化，非法转移被拒（exit 1）
   - 所属模块：core + cli；依赖：pi-rpc-vertical-slice（workitem 关联真实 run 记录，lane 需 run 数据校准）、verifier-gate-engine（gate action 裁定复用 PolicyEngine，`rolekit gate` 命令组为 WI- 前缀路由的宿主）；状态：done
9. **knowledge-layer** — 按 4.10 冻结格式实现 KnowledgeEntry 四类（rule / adr / learning / note）读写与检索；验收：(1) 新增 rule 条目出现在下一次编译的 prompt.md（断言测试）；(2) 四类条目各 ≥1 正例 + 1 负例通过 `rolekit validate`（含 adr 四节标题断言、rule 单段断言）；(3) 检索命令按 type / tags / status 过滤正确
   - 所属模块：core + cli + runner(read-only)；依赖：workitem-lifecycle-core（依赖 workitem 落盘/锁先例与同级 `.rolekit` 约定；v1 无 WorkItem FK/状态联动）；状态：in-progress
10. **migrate-tool** — `rolekit migrate --from codestable|superpowers`；验收（防全 skip 绕过）：(1) 防整类漏扫：adapter mandatory类别必须全行输出；每个识别出的 semantic entity 必须精确记为 migrate/merge/封闭skip/error，非skip/error项必须有唯一target或merge target，禁止静默消失或伪造全成功。(2) 状态映射表冻结：draft→planned，planned/planning→planned，design/designing→designing，in-progress/active/implementing→executing，review/qa/verify→verifying，done/completed/accepted→done，dropped/cancelled→dropped，paused/blocked→blocked，未知状态→迁移失败（报告列出，exit 1，不猜）；roadmap 主文档本身迁为 WorkItem(kind=goal)，其 items 为该 goal 的 depends_on 集；KnowledgeEntry 状态与 compound 类型映射见 4.10；(3) 去重合并规则：迁移主键 = feature 目录名，已绑定 feature 的 roadmap item 与该 feature 合并为同一 WorkItem（依赖关系并入 depends_on），仅未绑定 feature 的 item 独立建项——"一对一"判据改为报告中每个源实体有唯一目标或显式合并目标；(4) skip 仅三类：已识别 semantic 文档零字节或去frontmatter+标题后无正文的 empty-placeholder、owner decisions 显式弃用、同类别 canonical projection duplicate；`.gitkeep` 非entity，只进 report.discarded(reason=empty-placeholder)，不计 skipped；每个 skip 必落理由与计数。(5) 语义保真断言 + 抽样 diff 复核；(6) 转换产物 `rolekit validate` 全过；(7) 源目录只读不动。(8) SourceManifest 在 scan 前/promote 前 byte-equal，path/symlink/size/UTF-8 安全门闩过；(9) apply 仅 fresh target，完整 staging 全量 validate 后目录 rename，故障零正式 target，identity+三digest全等才no-op；(10) support 不物化，skip 仅 empty-placeholder/owner-deprecated(decisions)/duplicate，merge 非 skip；(11) Superpowers adapter 仅 `codex-superpowers-5.1.3@1` + MIT，14 skill 恰映射 8 namespaced RoleProfiles + 6 active-but-non-injected Knowledge notes，root/support 全进 evidence/discarded 台账；(12) profiles 仅按冻结 heading/template 提炼，脚本/agent prompts 不复制，禁词 lint、profile validate/compile 全过；(13) deterministic semantic diff 覆盖每非空必迁类别首尾及全部 merge/skip/error，非声明差异失败；(14) mapping.json={version:1,entries}；每个 roadmap item 固定 category/source_key/source_locator，bound merge 与 unbound migrate 字段真值表唯一，apply 均有最终 target_id 且 locator 唯一解析目标；bound/unbound title 均为trim后的完整item.description；(15) WI/KN/Profile logical target_key 使用类型前缀+冻结percent编码，unbound key含roadmap slug，bound merge_into全等feature key且全局碰撞失败；(16) 全部机器JSON用RFC8785 UTF-8无BOM/尾换行并锁raw sha；(17) evidence-only/support只进provenance/counts.evidence不进mapping，created按冻结source日期优先级且禁mtime/current-time回退；(18) category/source_key闭表，attention ordinal/重复H2与KN title/created fixtures全绿；(19) assignIds分WI/KN字节排序三位计数，fingerprint含plan_version/adapter_id/full source+decisions sha且id取前24，空decisions原像固定；(20) MappingEntry field_map/assertions、report.provenance/discarded 均用封闭结构，discarded只进report；(21) 全量分组后feature的bound数>1即整迁merge_conflict且相关items与被争用feature均为mapping action=error且两mandatory行failed计数对应，Superpowers note body/说明句完全冻结；(22) .gitkeep仅report.discarded、semantic empty才skip，compound/attention status=active；迁移WI用固定YAML writer且updated=单次applyInstant；Superpowers discarded/provenance单落点、counts.discarded与attention tags均有精确不变量；(23) RoleProfile canonical YAML writer、全部bundle envelope/counts/receipt no-op、versioned fingerprint、attribution tags/comment、duplicate projection与dependency/validation错误边界均按migrate design冻结；(24) map八步顺序、被引用target禁止任何skip、error plan在lock前失败、no-op identity+三digest真值表、mandatory数组/CLI report-target三态与compound闭表全部冻结；(25) multi-bind相关items以mapping action=error记账；decisions用canonical entity ref且零/多匹配失败；adapter mandatory类别全行输出；per-entity source_digest算法与apply-error无磁盘报告/可选既有audit指针冻结；(26) item10(1)+items description消除零skip旧句；roadmap depends bound改写/错误表、multi-bind feature+items error行、error-details落盘与roadmap status字段/self expected counts均冻结；(27) self全部10个gitkeep、semantic-vs-error两条detail hash链、staging失败ReportPointer、message_code=error code与items description conditional no-op均冻结。superpowers 样例包完成同等审计 + 转换
    - 所属模块：migrate；依赖：workitem-lifecycle-core + knowledge-layer（迁移目标格式由 4.9/4.10 冻结）；状态：planned
11. **hardening-dogfood-switchover** — Pi steer durable request；九phase/lost→新attempt；WorkItem question/drop/resume/migrated claim；ErrorCatalog/run integrity；固定 rolekit-self+ctxline 两真实项目十WorkItem且全部lane=delegated。台账分母为WI refs与两index并集的全部run（含失败/取消/重试/orphan/multi-ref/null行）；CampaignEvaluation内嵌D6f strict DogfoodLedger/DogfoodMetrics，RFC8785投影与三sha可复算；每run调用evals evaluateRun无meta且contract/envelope pass，Envelope=100%；integrity=100%；Σ全部非null scope_violations_count=0且无scope null blocker（严格口径B：任一命中即永久hold、负例仅campaign外）；人工confirm仅七类白名单；预指定RK-01 caller-crash与RK-04 deadline-past owner-loss（g03 candidate、60s kill margin）的raw receipts须过live-evidence谓词，另有RK-03/RK-05两次nonce唯一accepted、其中RK-05机械证明delivery；十WI最终done且≥6 code/test patch、三profile。RK-06 task固定research/researcher/chatgpt-codex（live；openai-responses 保留第二实现、互不静默降级）且最终采纳completed run须过既有check:research四断言；RK-07必须是迁移所得本roadmap WI。最终SwitchDecision必须go，hold报告不算完成；actual cutover另获owner授权。
    - 所属模块：跨模块；依赖：host-adapter-skills, role-profiles-migration, verifier-gate-engine, research-module, evals-fixtures, migrate-tool；状态：in-progress

**最小闭环**：第 2 条 `pi-rpc-vertical-slice`——整个体系价值假设的验证点，四个阶段验收点保证失败可归因。

### Goal Coverage Matrix

| Goal / completion signal | Covered by item(s) | Verification entry | Evidence type | Core? |
|---|---|---|---|---|
| 10 类 schema 冻结：每类 ≥1 正例 + 2 负例 fixture 判定正确（含 gate-record） | contract-schemas, verifier-gate-engine | `rolekit validate` fixture 套件 + `npm test` | command | yes |
| 真实项目同一契约连续 2 次端到端成功 + 1 次 cancel，五件产物齐全 | pi-rpc-vertical-slice | dogfood run + `rolekit verify`（Windows） | run artifacts | yes |
| 越界写入在集成前被拦截、主区注入变更被基线检查捕获（scope_violations 非空、Envelope failed） | pi-rpc-vertical-slice, verifier-gate-engine | 注入越界的测试 run | test + events 审计 | yes |
| 2 宿主经薄 Skill 驱动同一 CLI 各 ≥1 次委派 | host-adapter-skills | 两宿主 run 记录 | run artifacts + skill diff | yes |
| 7 profile 全过校验可编译；3 角色各 ≥1 次真实 run | role-profiles-migration | `rolekit validate` + 链路 run | command + run artifacts | yes |
| 合规 run 全程 0 人工 gate 且留 observe 审计 | verifier-gate-engine | acceptance-observe policy + events.jsonl / gates.json | test + events + run artifacts | yes |
| 越界注入 run 集成前 block（enhanced 单次 scope gate record） | verifier-gate-engine | 注入越界 run + gates.json | test + events + run artifacts | yes |
| WorkItem 全生命周期命令化，非法转移 exit 1 | workitem-lifecycle-core | `rolekit workitem` e2e | command + work-items diff | yes |
| 本仓库 .codestable 自迁移：必迁entity唯一target/merge、封闭skip、状态/依赖/knowledge保真、fresh apply全validate、source checksum相同、重跑no-op | migrate-tool | rolekit migrate --from codestable --target <fresh> + validate:migrations | report+semantic diff+manifests+receipt | yes |
| Superpowers 5.1.3样例：MIT/version gate、14→8 profiles+6 notes、profile无编排残留且validate/compile全过、源只读 | migrate-tool | rolekit migrate --from superpowers --source <fixture> --target <fresh> | report+profile/note diff+license+manifests | yes |
| rolekit-self+ctxline固定10 WI全为delegated且done；全attempt Contract/Envelope/Integrity=100%，严格scope=0（任一命中永久hold），confirm仅白名单；2次steer、预指定caller/lost的live-evidence receipts与恢复、RK-06 check:research、自举迁移RK-07、SwitchDecision=go | hardening-dogfood-switchover | audit:dogfood + check:research + check:switch + Windows live campaign | plan+source manifests+all-run ledger/metrics+migration+switch report | yes |

紧随追加：“Envelope 分项唯一调用 evals `evaluateRun(runDir)` 无 meta；integrity/scope/gate/WI 是独立聚合，audit 不重算 Envelope 公式。scope 采用全 campaign attempt 严格零命中，负例只在 campaign 外 fixture/e2e；命中后不得以替代 campaign 抹除。”
| kind=research 契约 run 产出 report.md + activity.json，四条断言脚本全过 | research-module | research run + 引用核验断言脚本 | run artifacts + 断言输出 | no |
| `npm run evals` 一键回归 | evals-fixtures | `npm run evals` | command | no |
| rule 注入编译 prompt + 四类 KnowledgeEntry 校验与检索正确 | knowledge-layer | mock run prompt+knowledge-snapshot、knowledge search e2e、validate 四类正负 | test + command | no |

## 6. 排期思路

按 ADR 002 顺序拆：先建 CodeStable 没有的执行层（1-7），过渡期生命周期仍用 CodeStable；契约被真实 run 验证后再吸收生命周期（8-9），最后迁移与收口（10-11）。schemas 排第一因为它是共享地基（改动成本最高）；Pi RPC 排第二因为它是最大技术未知，必须最早暴露。3-7 只依赖垂直链路，顺序可按 owner 优先级调整。卡点：第 2 条必须在 Windows 真实验证；第 6 条研究执行路线（openai-responses adapter vs Pi 会话 + web 工具）在 design 阶段拍板；第 10 条依赖 superpowers 包盘点（design 阶段做）。

**目标完成信号**：Goal Coverage Matrix 的 9 个 core 信号全部量化可复验；总收口以第 11 条的运行台账（≥2 项目 ≥10 work item、完整率 100%、违规 0、自举完成）+ 切换决定报告为准。

**Top 3 风险与缓解**：

1. 范围膨胀重蹈 sdk-first——缓解：垂直链路四个阶段验收点固定范围（steer 明确延后）；schema 带版本号冻结，改动走 roadmap update；每条 item 验收量化不允许"顺手做"
2. Pi RPC 长任务稳定性与恢复语义未知（Windows spawn、中断恢复、版本漂移）——缓解：阶段验收点 2（RPC smoke）最早暴露；probe + 版本窗口（仿 veritack peerDependencies `>=0.80 <0.90` 先例）不钉死版本；MockExecutor 保证 runner 逻辑独立可测；垂直链路 design 设 timebox 与 fallback 触发条件（不成立则切 Pi SDK 进程内 adapter，seam 不变）
3. CodeStable 裁剪失当——缓解：4.9 已冻结 WorkItem/状态机/lane 硬约束；design 阶段盘点清单（留/砍/改）owner 过目；migrate-tool 以本仓库自迁移量化验收

**非显然依赖**：Pi RPC 协议版本窗口；veritack 仅只读参考、无包依赖（ADR 006）；research-module 若走 openai-responses 路线依赖 OpenAI API Key 与账户模型权限（env 注入，禁止硬编码，ADR 规约），走 Pi 会话路线依赖 web 检索扩展（pi-exa-fetch 仅参考，需 RoleKit 自带或声明前置）；obra superpowers 包结构与许可；Node >= 22.18（TS 直跑，ADR 004；veritack engines `>=22 <25` 可作对齐参考）；Windows 为第一验证环境。

**关键假设**：Pi headless RPC 可在 Windows 稳定 spawn 并配合 git worktree（阶段验收点 2 第一周验证）；TypeBox 表达力足够（含 4.4 的 discriminated union）；owner 日常工作可逐步契约化（自举与运行台账验证）。

**基线与验证入口**：greenfield，基线由第 1 条建立并写入 CI 命令矩阵：`npm test`（单测）、`tsc --noEmit`（类型）、lint（工具在第 1 条 design 定）、CLI e2e（spawn 真实 CLI 进程断言 exit code 与 --json 输出）、Windows smoke（垂直链路起为必跑）；支持矩阵：Node 版本范围 + Pi 兼容窗口声明。真实验证场为 veritack dogfood 项目群。无 brownfield 基线风险；第 2 条即体系 safety net。

**交付物落点**：见第 5 节各条验收与 Goal Coverage Matrix evidence 列；run 证据落 `.rolekit/runs/`，roadmap 状态回写本目录 items.yaml。

**知识回写点**：Pi RPC 兼容窗口与 Windows spawn 坑（→ compound）；TypeBox discriminated union 用法（→ compound）；Node/Pi 版本硬约束（→ attention）；dogfood 验证成立的 gate 默认档（→ policies 模板 + compound）；veritack 判据吸收清单（→ design 文档 + compound）；research 执行路线决策与 citation 核验经验（→ design 文档 + compound）。

## 7. 观察项

- deepsearch讨论.md 提到的 Pi 扩展 MVP（ZIP）若 owner 手头有，可作 research-module design 的额外参考，但非前置——模块按 RoleKit 原生自研推进
- research-module 两条执行路线的取舍点：openai-responses adapter 顺带验证"executor 可替换"宣称但引入 OpenAI 计费依赖；Pi 会话 + web 工具复用现有 executor 但长任务进度/取消粒度较粗——design 阶段以此为评审框架
- P5 命名分发（npm scope、CLI 命名冲突检查、plugin 打包）未拍板，建议 contract-schemas design 时定 npm scope，plugin 另立条目
- `.codestable/attention.md` 仍是空骨架，建议 `cs-note` 补：Node 版本窗口、Windows 第一环境、dogfood 项目路径清单
- sdk-first 备份中的 RPC 恢复语义结论建议在垂直链路 design 前提炼为 compound 沉淀（`cs-keep`）
- `network: deny` 第一版只是声明 + 事后审计，真网络隔离为残余风险，后续 roadmap 处理
- 尚无 requirement 文档；若需要能力愿景层描述，后续 `cs-req draft`，本 roadmap 不阻塞

## 8. 变更日志

- 2026-07-24：round 1 独立审查后修订——补量化完成信号（RMR-001）；补 schema 字段、RunHandle/RunStatus/ExecutorReport、错误模型、幂等与超时语义、Envelope 组装所有权（RMR-002）；新增 4.9 WorkItem/状态机/lane 冻结契约（RMR-003）；明确越界/网络第一版执行机制与诚实边界（RMR-004）；veritack 集成改为方向决策先行、禁止深导入（RMR-005）；垂直链路收敛为四阶段验收、steer 延后（RMR-006/011）；GatePolicy 升级 trigger→action 四级（RMR-007）；依赖边补消费产物理由（RMR-008）；deep-research 标外部前置（RMR-009）；基线补 CI 命令矩阵与版本支持矩阵（RMR-010）
- 2026-07-24：round 2 独立审查后修订——migrate 验收冻结必迁类别 / 封闭 skip 原因集 / 语义保真断言（R2-001）；RunContext 增 attempt 字段并定义分配规则（R2-002）；4.9 状态机增 gate 字段与 origin 恢复语义、done 命令定义为 final-acceptance 封装（R2-003）；删除"物理不可达"过度承诺、增主工作区基线检查并明确承诺口径（R2-004）；probe 增 capabilities、错误模型增 ExecutorUnsupportedOperationError 及 CLI 行为（R2-005）；Envelope 完整率给出分子分母与机械判据（R2-006）；WorkItem 增 lane_reason / lane_overrides 持久化（R2-007）；veritack 条目明确两阶段、决策后更新条目再实现（R2-008）；schema 口径统一为 8 类（R2-009）
- 2026-07-24：round 3 独立审查后修订——WorkItem.kind 增 goal 承接 goals 迁移（R3-001）；新增 4.10 KnowledgeEntry 冻结知识层目标格式、schema 口径升为 9 类、knowledge-layer 验收扩为四类条目校验（R3-002）；migrate 增去重合并规则（feature 目录名主键，已绑定 item 合并）（R3-003）；GateOrigin 收窄三态、gate 字段条件校验、增 gate_log（R3-004）；final-acceptance 四动作语义逐一冻结（R3-005）；migrate 冻结源状态映射表与未知状态失败策略（R3-006）；主区基线检查措辞改为"检测到并发变更"不归因 worker（R3-007）
- 2026-07-24：round 4 独立审查后修订——4.10 补 ADR 状态映射与 compound 类型机械分派（R4-001）；状态映射表补 draft→planned、明确 roadmap 主文档迁为 goal WorkItem（R4-002）；4.9 增 goal 完成不变量（R4-003）；第 2 节协议清单同步 9 类口径（R4-004）
- 2026-07-24：owner review 修订——veritack 方向由 owner 拍板为"吸收 + 改良"，`veritack-verifier-integration` 更名 `verifier-gate-engine`，取消四选一 design gate，改为吸收清单设计产物，不依赖 veritack 包（ADR 006）；`deep-research-capability-pack` 更名 `research-module`，从"迁移外部扩展"改为"RoleKit 原生自研"（参考 deepsearch讨论.md 工作流与 pi-web-fetch 检索层），解除外部源码前置；§2 增"参考仓库只读、产物必须 RoleKit 原生"owner 原则
- 2026-07-28：verifier-gate-engine D9 batch patch——协议清单 9→10（gate-record）；§3 core/runner/cli 挂载 PolicyEngine/pipeline/gate router；4.1 第10类 gates 根 schema；4.5 `gate <id>` 前缀路由；4.6 PolicyEvaluation + scope 机械硬失败 + Verifier/Pipeline 两层 seam；4.8 gates/detect-snapshot/immutable change-manifest；Matrix/items 同步；ADR 003 class-(1) 改为 detector+GatePolicy 触发、escalation 仅审计
- 2026-07-29：workitem-lifecycle-core batch patch——4.5 增 `workitem design` 与 WI-/run- 分 shape gate router；4.8 work-items 全局锁/原子替换；4.9 D4 自动过桥、start prepare/link/start/wait/adopt saga、D7 阈值、lane 新-run 镜像；host-adapter 命令表跟进
- 2026-07-29：hardening-dogfood-switchover D12 batch patch——4.3 steer(control.requestId)/barrier/错误码；4.5 drop/resume/steer flags；4.8 control/steer+transition_intent+dogfood 布局；4.9 recovery_runs_count 与 start 优先级 A/B/C；item11/Matrix 严格口径 B + SwitchDecision=go；host command-map Available 全量提升
- 2026-07-24：round 6 聚焦复审后修订——research-module 契约衔接冻结：进度复用既有 RunEvent 类型、ExecutorProfile.adapter 改注册表校验（schema 不枚举 adapter 名）、产物固定 report.md + activity.json 且 evidence 仅存路径（R6-001）；research-module 验收改为四条断言脚本机械判定（R6-002）；approval 报告与 review 报告同步新口径（R6-003）；ADR 003 措辞修正为"吸收判据设计、原生实现"并关联 ADR 006（R6-004）；veritack 原语统一为 Run/Context/Check/Gate/Record 五原语（R6-005）；closure 复核补两条：review 报告元数据升 round 6 补 closure 记录（R6-006）、adapter 注册表归属明确为 runner 所有 CLI 仅透传 unknown_adapter（R6-007）
