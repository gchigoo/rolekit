# contract-schemas 字段对照自查表

权威：roadmap §4.1–4.10。TypeBox 属性必须与下表一一对应。

## 4.1 TaskContract → `task-contract.ts`

| roadmap 字段 | TypeBox | 备注 |
|---|---|---|
| schema | Literal `rolekit/task-contract@1` | |
| id | string minLength 1 | |
| kind | implementation\|research\|review\|fix | |
| role | string | |
| executor | string | |
| objective | string | |
| context.required_files | string[] | |
| context.docs | string[] | |
| scope.writable | string[] | 语义：glob-ish |
| scope.forbidden | string[] | 语义：glob-ish |
| constraints | string[] | |
| deliverables | string[] | |
| acceptance.commands[].run | string | 语义：commands≥1 |
| acceptance.commands[].expect_exit | number | |
| acceptance.assertions | string[] | |
| execution.worktree | isolated\|in-place | |
| execution.max_tool_calls | number | |
| execution.network | deny\|allow | |
| execution.timeout_minutes | number | |
| escalation.on_scope_change | EscalationAction | |
| escalation.on_new_dependency | EscalationAction | |
| escalation.on_ambiguous_requirement | EscalationAction | |

## 4.2 ResultEnvelope → `result-envelope.ts`

| roadmap 字段 | TypeBox | 备注 |
|---|---|---|
| schema | Literal `rolekit/result-envelope@1` | |
| task_id | string | |
| status | completed\|blocked\|question\|failed\|cancelled | 语义规则 D7.2 |
| summary | string | |
| changed_files | string[] | |
| verification[].command | string | |
| verification[].exit_code | number | |
| scope_violations | string[] | 非空 ⇒ status≠completed |
| decisions | string[] | |
| assumptions | string[] | |
| evidence | string[] | |
| risks | string[] | |
| unresolved | string[] | status≠completed ⇒ 非空 |
| recommended_next_action | string | |

## 4.3 ExecutorReport → `executor-report.ts`

| roadmap 字段 | TypeBox | 备注 |
|---|---|---|
| schema | Literal `rolekit/executor-report@1` | 自有 schema |
| 其余 | Envelope 减去 verification / scope_violations | 无 D7 语义复制 |

## 4.4 RunEvent → `run-event.ts`

| 公共字段 | TypeBox |
|---|---|
| schema | Literal `rolekit/run-event@1` |
| ts | string (ISO8601) |
| run_id | string |
| type | 7-variant discriminator |

| type | payload |
|---|---|
| started | task_id, adapter, worktree |
| tool_call | name, args_digest |
| message | role worker\|system, text |
| gate | gate, action, decision, evidence |
| verification | command, exit_code |
| escalation | rule (escalation keys), action, detail |
| finished | status, reason string\|null |

## 4.6 GatePolicy → `gate-policy.ts`

| roadmap 字段 | TypeBox |
|---|---|
| schema | Literal `rolekit/gate-policy@1` |
| default_action | ignore\|observe |
| triggers.new-dependency | GateAction |
| triggers.migration | GateAction |
| triggers.public-api-change | GateAction |
| triggers.delete | GateAction |
| triggers.scope-violation | GateAction |
| triggers.ambiguous-requirement | GateAction |
| triggers.design-artifact | GateAction |
| triggers.final-acceptance | GateAction |

## 4.7 RoleProfile → `role-profile.ts`

| roadmap 字段 | TypeBox |
|---|---|
| schema | Literal `rolekit/role-profile@1` |
| name | string |
| capabilities | string[] |
| boundaries | string[] |
| deliverables | string[] |
| verification | string[] |
| prompt_fragments | string[] |

## 4.7 ExecutorProfile → `executor-profile.ts`

| roadmap 字段 | TypeBox | 备注 |
|---|---|---|
| schema | Literal `rolekit/executor-profile@1` | |
| name | string | |
| adapter | string minLength 1 | **禁止枚举** |
| model | optional string | |
| settings | optional object | |

## 4.9 WorkItem → `work-item.ts`

| roadmap 字段 | TypeBox | 备注 |
|---|---|---|
| schema | Literal `rolekit/work-item@1` | |
| id | string | |
| kind | feature\|issue\|refactor\|research\|**goal** | 含 goal |
| title | string | |
| status | WorkItemStatus | |
| gate | {trigger, origin}\|null | 语义：⇔ awaiting-gate |
| gate_log[] | trigger, action, decision, ts | |
| lane | direct\|delegated\|coordinated\|null | |
| lane_reason | string\|null | |
| lane_overrides[] | by, from, to, reason, ts | |
| depends_on | string[] | |
| runs | string[] | |
| created | string | |
| updated | string | |

## 4.10 KnowledgeEntry → `knowledge-entry.ts`

| roadmap 字段 | TypeBox | 备注 |
|---|---|---|
| schema | Literal `rolekit/knowledge-entry@1` | frontmatter |
| id | string | |
| type | rule\|adr\|learning\|note | 语义 body 断言 |
| title | string | |
| status | active\|superseded\|deprecated | |
| tags | string[] | |
| created | string | |
| source | string\|null | |

validate 载荷：`{ frontmatter, body }`；结构层只验 frontmatter。
