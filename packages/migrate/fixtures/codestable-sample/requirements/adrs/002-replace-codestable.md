---
id: 002
title: 长期替代 CodeStable，精简吸收精华并提供遗产迁移工具
status: accepted
date: 2026-07-24
relates_to: [001, brainstorms/rolekit-v2-direction]
---

# 长期替代 CodeStable，精简吸收精华并提供遗产迁移工具

## Context

CodeStable 提供成熟的生命周期建模（实体、gate、过程产物、组织记忆），但过重：20+ skill 入口、流程写在文档里靠 LLM 自觉遵守、步步 checkpoint。若 RoleKit 自带完整生命周期目录与 `.codestable/` 并行，会出现双生命周期两套真相。

## Decision

RoleKit 形成自有体系，长期替代 CodeStable。裁剪主线是流程从文档驱动改为代码驱动（状态机 + CLI + schema 校验，文档只剩薄入口）。吸收：生命周期实体（九聚合根合并为 WorkItem + kind，目录收敛 work-items / runs / knowledge）、风险分级 lane、声明化 gate 配置、过程产物可复核、组织记忆两层（attention 式短规则 + 可检索沉淀含 ADR）、evals/fixture。砍掉：多 skill 入口与兼容入口、route brief / preflight 仪式、13 份 conventions 文档树、步步 approval-report。提供 `rolekit migrate --from codestable|superpowers`（superpowers 指 obra 通用工作流技能包）。过渡期生命周期继续用 CodeStable 顶着，先建执行层。

## Consequences

- 最终单一体系，无双目录漂移
- 迁移工具成为一等公民工作项（语义映射表、frontmatter 转换）
- 第一阶段仍聚焦执行层，生命周期吸收后置，避免重蹈 sdk-first 因重而死
- 本仓库当前的 `.codestable/` 将来由 migrate 工具自我迁移（自举验收场景之一）

## Alternatives Considered

- 纯执行层永久分工（CodeStable 管做什么、RoleKit 管怎么执行）：定位锐利，但 owner 明确要自有体系
- 并行两套生命周期目录：双份真相，最差结果
