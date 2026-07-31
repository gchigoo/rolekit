# RoleKit

以软件生命周期和任务契约为中心、由宿主 Agent 决策集成、由可替换执行器完成受约束任务的开发控制系统。

## Language

**Role**:
一份能力契约：能力要求 + 行为边界 + 交付物 + 验证规则，不绑定任何具体运行时。
_Avoid_: 角色人格, Agent 角色

**Executor**:
当前被选择来执行某个 Role 的运行时（pi / codex-subagent / local-script 等），经 ExecutorAdapter 接口接入。
_Avoid_: Agent, Worker

**Task Contract**:
单次委派的机读任务契约：目标、上下文清单、写入 scope、约束、交付物、验收命令、执行预算、升级规则。
_Avoid_: 任务描述, prompt

**Result Envelope**:
执行结果的机读回执：状态、变更文件、验证证据、决策、假设、风险、遗留项。宿主只消费 Envelope，不消费执行过程噪声。
_Avoid_: 执行报告

**Run**:
一次 Task Contract 的执行实例及其全部落盘记录（prompt、events.jsonl、result.json、artifacts）。

**Work Item**:
生命周期工作单元，单一模型以 kind 区分 feature / issue / refactor / research / goal。
_Avoid_: 聚合根, ticket

**Gate**:
状态机推进的放行判据。确定性 gate 依机械证据自动放行；人工 gate 仅白名单四类（不可逆动作、语义歧义、设计类产物、最终验收）。
_Avoid_: checkpoint

**Lane**:
执行拓扑分级：Direct（宿主自己做）/ Delegated（单 Worker 委派）/ Coordinated（多只读探查 + 隔离 Worker）。

**ValidationResult**:
契约校验统一返回值：`{ valid: true }` 或 `{ valid: false, issues, code? }`；issue 含 `layer`（structural|semantic）与字段级 `path`。
_Avoid_: 校验布尔

**语义规则**:
跨字段条件约束，由每类 schema 的 `semanticRules` 纯函数实现；结构校验失败后短路，不执行语义层。
_Avoid_: 业务规则, invariant checker

**schemaRegistry**:
schema 字面量 kind → `{ schema, semanticRules }` 的注册表；`validateArtifact` / CLI / 后续 migrate 共用。
_Avoid_: schema map

