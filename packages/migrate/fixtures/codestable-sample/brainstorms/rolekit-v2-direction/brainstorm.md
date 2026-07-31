---
doc_type: brainstorm
slug: rolekit-v2-direction
created: 2026-07-24
status: active
summary: RoleKit v2 定为宿主无关、契约中心、执行器可替换的自有开发控制系统，长期替代 CodeStable
tags: [rolekit, architecture, direction, codestable, pi, executor]
---

# RoleKit v2 项目走向

> 创意空间 | 2026-07-24 | 下一步：cs-epic

## 出发点

RoleKit 经历三次形态：v0.1 Prompt 驱动角色库（`D:\Personal\pi-delivery-rolekit`，可用但契约是 markdown、executor 锁死 Pi 子进程）；sdk-first 重设计（2026-07-21 备份，design review 通过但过重 ~3k 行、钉死 Pi 0.80.10，已搁置）；`讨论.md` 新提案（Core + Codex Skill + Pi Runner + 后置 MCP）。本次讨论目的：结合三份既有实现与 veritack（`D:\Personal\skeg`，v1.3.1 证据/风险控制层）收敛项目走向。

## 聊过的方向

- A 按讨论.md 全蓝图新建 monorepo（Codex 主控）——否决 Codex 主控假设：既有资产全在 Pi 侧，该提案是站在 Codex 生态给的答案
- B 原地演进 pi-delivery-rolekit——否决：仓库形态迁就旧结构，宿主无关性长不出来
- C 协议先于系统（只做 schema + 薄 CLI，复用现有件）——部分吸收：契约先行、第一刀要小，但 owner 终态目标是自有体系而非插件
- 与 CodeStable 关系三选一（纯执行层 / 并行两套 / 替代）——选替代，避免 `.rolekit/` 与 `.codestable/` 双生命周期

## 当前倾向

已收敛：RoleKit v2 = 精简生命周期 + 契约执行层的自有体系，宿主无关，CLI 为唯一通用表面。本仓库 greenfield monorepo（packages/core、runner、cli、migrate + adapters + profiles + evals）。路径五阶段：冻结 4 schema → 垂直链路（CLI → PiRpcExecutor → 隔离 worktree → 验证 → Envelope）→ 迁移既有资产（deep-research 抽 capability pack、veritack 接验证 gate、7 角色转 profiles）→ 生命周期精简核心 → migrate 工具 + 切换；MCP 有真实多客户端需求再包。

## 已敲定的点

- D1 宿主无关 Core，各宿主薄 Skill 入口，工作流语义只住 Core——已确认（ADR 001）
- D2 长期替代 CodeStable：吸收精华、优化精简；`rolekit migrate --from codestable|superpowers`（superpowers = obra 通用工作流技能包）——已确认（ADR 002）
- D3 默认自动流转，人工 gate 白名单四类：不可逆/越权动作、语义歧义、设计类产物过目、最终验收；放行判据确定性化（veritack Check/Gate 原语接入 verifier）——已确认（ADR 003）
- D4 全 TypeScript 常规工具链，契约用 TypeBox 单一来源（运行时校验 + 静态类型 + JSON Schema 导出）——已确认（ADR 004）
- D5 配置格式：YAML 人写 + JSON/JSONL 机器产物，同一 JSON Schema 校验，不引入 TOML——已确认（ADR 005）
- P1 裁剪线：流程从文档驱动改代码驱动；九聚合根合并为 WorkItem + kind，目录收敛 work-items/runs/knowledge；砍 20+ skill 入口、route brief/preflight 仪式、13 份 conventions 文档树——已确认
- P3 仓库策略：本仓库 greenfield；pi-delivery-rolekit 原地保留作迁移源头，吸收完归档；sdk-first 备份仅作参考——已确认
- P4 验收场景：第一条垂直链路直接跑 owner 真实项目（veritack dogfood 覆盖的那批：skeg 自身、ado、repo-nav、blog 等），并尽早自举（用 RoleKit 跑 RoleKit 的 work item）——已确认
- Role ≠ Agent：Role = 能力要求+边界+交付物+验证规则；Executor = 被选中的运行时——已确认（沿讨论.md）
- 明显不做：第一版 MCP、双层 Agent 嵌套、开局支持全部角色/工作流、并行多 writer——已确认

## 遗留问题 & 下一步

- CodeStable 精华的逐项裁剪细目（哪些 gate/产物模板保留原样、哪些重设计）留给 epic 拆解内的专项盘点
- superpowers（obra 包）技能清单与映射语义需在 migrate 子 feature 内枚举
- Pi RPC 长任务恢复语义（steer/resume/abort 边界）可从 sdk-first 备份捞现成结论
- P5 命名与分发（npm 包名、plugin 打包）延到 epic 拆解
- 下一步：cs-epic planning 以本文档为输入拆解
