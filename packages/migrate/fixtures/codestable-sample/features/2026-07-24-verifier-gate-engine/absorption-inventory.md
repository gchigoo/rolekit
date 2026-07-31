---
doc_type: absorption-inventory
feature: 2026-07-24-verifier-gate-engine
source: skeg/veritack (read-only)
adr: 006
---

# veritack 吸收清单（ADR 006）

事实来源：skeg 源码只读探索（types/risk/closure/reducer/config）。五原语对照：Run→run 目录 + run-state；Context→TaskContract + policy/detect 快照；Check→Verifier + 六类检测器；Gate→PolicyEngine + GateEvaluationPipeline + awaiting-gate；Record→gates.json + events.jsonl。

## 借

| # | veritack | RoleKit |
|---|---|---|
| 借1 | TriggerPolicy 四级 ignore/observe/confirm/block | GatePolicy + PolicyEngine；8 类 trigger（4.6） |
| 借2 | 路径 glob 风险检测 | detectors：new-dependency / migration / public-api-change / delete；detect.yaml |
| 借3 | Check/Signal/Gate 三分 | 半确定性 hit 不进 VerificationReport，交 PolicyEngine；默认 public-api-change:confirm |
| 借4 | RunContract 冻结 checks | policy-snapshot + detect-snapshot 于 run start 固化 |
| 借5 | revision 绑定证据 | run 不可变、重跑新 run-id；无 run 内 revision 计数器 |

## 不借

| # | veritack | 理由 |
|---|---|---|
| 不借1 | Pi hook / tool_call 同步 confirm | ADR 001 宿主无关；confirm 走 run-state + CLI |
| 不借2 | run 内 mutation revision / phase 状态机 | RoleKit 单次契约进证据出 |
| 不借3 | dangerous command 实时拦截 | 依赖 hook；v1 靠 scope + escalation 审计 |
| 不借4 | 证据仅存 session RunState | 改为 gates.json + events 双写 |
| 不借5 | 默认全 trigger confirm | 与 ADR 003 默认放行冲突；按 4.6 冻结表 |

## 改良

| # | 点 | 内容 |
|---|---|---|
| 改良1 | 证据独立落盘 | gates.json + events gate 事件 |
| 改良2 | observe/ignore 真分叉 | observe 记审计自动过；ignore 零落盘 |
| 改良3 | 引擎纯函数化 | PolicyEngine 无 IO；detectors 可离线重放 |
| 改良4 | 优先级封闭 | 显式 trigger > default；overall block>confirm>observe>ignore |

禁止：`@veritack/pi-veritack` 依赖、fork、复制 skeg 源码。
