---
doc_type: feature-design-review
feature: 2026-07-27-hardening-dogfood-switchover
status: passed
review_state: passed
review_reason: ""
reviewer_id: "0401b354-ddf1-4e3f-82a2-fc7bdcf7ff4b"
reviewed: 2026-07-29
round: 2
---

# hardening-dogfood-switchover feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-design.md`
- Checklist: `.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-checklist.yaml`
- Intent / brainstorm: none
- Roadmap: `.codestable/roadmap/rolekit-v2/rolekit-v2-roadmap.md` + `rolekit-v2-items.yaml`
- Related docs: ADR 002、goal-features、上游 pi-rpc / workitem / evals / research / migrate / verifier-gate；research-module accepted（双 adapter）
- Code facts checked: packages 已有 `chatgpt-codex` + `openai-responses`；本轮焦点为 2026-07-29 owner dual-adapter 修订一致性

### Independent Review

- Status: completed
- Detection: independent-agent
- Provider / agent: cursor-grok-4.5-high-fast / `0401b354-ddf1-4e3f-82a2-fc7bdcf7ff4b`
- Raw output: 主会话 Task agent 回传；Verdict=`PASSED`（blocking=0 / important=0；nit FDR-201/202）
- Merge policy: nit 已文本闭合（goal-feature QA 措辞、D6d credential_missing 订阅 auth 映射、checklist 不变量、D8 机械列括号）；不回退 owner 已批 approved
- Gate effect: none — implementation 可按修订后 design 继续

## 2. Design Summary

- Goal: 收口 Pi steer/recovery/audit，以 rolekit-self+ctxline 十个真实 WI 台账裁定 SwitchDecision=`go`
- Key revision (2026-07-29): RK-06 live=`chatgpt-codex`；`openai-responses` 保留第二实现；互不静默降级；缺 `OPENAI_API_KEY` 不阻塞；缺订阅 auth 仍 blocking
- Steps: 8；Checks: 见 checklist

## 3. Findings

### blocking

none

### important

none

### nit

- [x] FDR-201 `goal-features/hardening-dogfood-switchover.md` §4 QA「Pi/OpenAI」→ `Pi/chatgpt-codex`（注明 openai-responses 仅可选）
- [x] FDR-202 `design.md#D6d` `credential_missing` 明确仅映射订阅 auth；仅缺 OPENAI_API_KEY 不得置该 reason
- [x] suggestion checklist 增 auth 不变量勾选项
- [x] suggestion D8 RK-06 机械列补 `(executor=chatgpt-codex)`

### suggestion

closed via nit merge above

### learning

- adapter 改道后，goal-feature QA 笼统词与 D6d 泛化 `credential_missing` 最易残留旧 API-key 心智

### praise

- owner 修订贯通 D6b/D7b/D12/matrix/checklist/items 与 research-module；overlay 双 executor / ctxline 禁 research 边界清楚

## 4. Round 1 Closure (historical)

- FDR-001..004 closed；status 曾为 passed（2026-07-28）
- Round 2 因 dual-adapter owner 修订重开后再次 passed

## 5. Verdict

passed — independent reviewer round 2；blocking/important 均为空；nit 已本地闭合
