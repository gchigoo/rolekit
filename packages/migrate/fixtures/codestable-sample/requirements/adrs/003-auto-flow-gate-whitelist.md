---
id: 003
title: 默认自动流转，人工 gate 白名单四类
status: accepted
date: 2026-07-24
relates_to: [002, 006, brainstorms/rolekit-v2-direction]
---

# 默认自动流转，人工 gate 白名单四类

## Context

CodeStable 步步 checkpoint 是其沉重感的主要来源。自动推进的前提是放行判据可机械化；veritack（v1.3.1）的 Run / Context / Check / Gate / Record 确定性原语和证据记账验证了这类判据可行——其设计经 ADR 006 以"吸收改良"方式进入 RoleKit 原生实现，不作为包依赖。

## Decision

状态机默认自动推进，放行判据为机械证据（命令 exit code、schema 校验、写入 scope 检查、revision 一致性），不是"问一下用户"。人工 gate 收敛为白名单四类：(1) 不可逆 / 越权动作（新增依赖、迁移、公开 API 变化、删除、越 scope 写入）——v1 由机械 detector+GatePolicy 触发；contract escalation 仅审计；(2) 语义歧义（需求多解、worker 返回 return_question）；(3) 设计类产物（design / plan）人工过目；(4) 最终验收。gate 声明化于 `policies/gates.yaml`，按项目可调，默认档为"默认放行、异常拦截"。

## Consequences

- 吞吐显著提升，owner 只在关键节点决策
- 要求所有验收判据尽量机械化；verifier 吸收 veritack 判据设计、由 RoleKit 原生实现（ADR 006）
- 自动放行的可追溯性依赖 events.jsonl 与证据落盘完整
- 无法机械化的判据必须显式归入四类之一，不得静默自动过
- class-(1) 归一化升级（escalation→自动 hit）后置；v1 以 detector+GatePolicy 为唯一放行裁定

## Alternatives Considered

- 只停最终验收：不可逆动作自动放行风险过高
- 步步确认（CodeStable 现状）：正是要替代的痛点
