---
id: 006
title: veritack 判据吸收改良为原生 verifier + gate 引擎，不做包集成
status: accepted
date: 2026-07-24
relates_to: [002, 003, roadmap/rolekit-v2]
---

# veritack 判据吸收改良为原生 verifier + gate 引擎，不做包集成

## Context

RoleKit 的自动流转（ADR 003）依赖机械验证与 gate 引擎。skeg（veritack v1.3.1）已实现成熟的证据与风险控制层：Run/Context/Check/Gate/Record 五原语、TriggerPolicy 四级语义（ignore/observe/confirm/block）、revision 闭合、证据记账。但其 npm 公开面只有 `./provider-api`（供第三方向 veritack 提供 check/policy），核心原语未导出且禁止深导入 `src/*`。roadmap 独立审查曾把"集成方向"列为四选一 design gate（改 veritack 发布面 / 消费其 CLI 产物 / provider 反转 / 自研借鉴）。

## Decision

owner 拍板：**吸收 + 改良，不集成**。RoleKit 自研 `verifier-gate-engine`，只读参考 veritack 的判据设计（五原语、TriggerPolicy 语义、revision 闭合、证据记账），改良为适配 RoleKit 契约模型（TaskContract / ResultEnvelope / RunEvent）的原生实现。本决策同步修正 ADR 003 中"veritack 直接作为判据提供者 / verifier 复用其原语"的表述——"复用"仅指概念吸收。不依赖 `@veritack/pi-veritack` 包、不 fork 其代码、不改其发布面。design 阶段产出吸收清单（借什么 / 不借什么 / 改良点），走 ADR 003 设计类人工 gate。同一原则推广到全部参考仓库：pi-delivery-rolekit、pi-web-fetch、deep-research MVP 一律只读参考，产物必须是 RoleKit 原生配套。

## Consequences

- 无外部包版本耦合，verifier 演进完全随 RoleKit 契约模型走
- veritack 判据设计经验（dogfood 验证过的默认档）以吸收清单形式进入 design，不带入其实现约束
- 需自担 verifier 实现与维护成本；MinimalVerifier（垂直链路）先行，本引擎在其上强化
- skeg 仓库保持原样运行，两系统并存互不影响

## Alternatives Considered

- veritack 增加正式 core API 后集成：owner 拥有该项目但改动其发布面，且形成双向版本耦合
- 消费 veritack CLI / 产物：进程边界带来产物格式耦合，且其产物语义与 RoleKit 契约模型不对齐
- RoleKit 实现为 veritack provider（方向反转）：控制权在 veritack，与"RoleKit 为主体系"定位冲突
