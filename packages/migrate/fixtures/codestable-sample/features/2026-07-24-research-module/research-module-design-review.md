---
doc_type: feature-design-review
feature: 2026-07-24-research-module
status: passed
review_state: passed
review_reason: ""
reviewer_id: "6097aa1d-168e-405b-9091-a096c8464738"
reviewed: 2026-07-29
round: 2
---

# research-module feature design 审查报告（chatgpt-codex 改道）

## 1. Scope And Inputs

- Design / Checklist / goal-features / attention / registry + openai-responses 现状
- Independent Review: completed，agent `6097aa1d-168e-405b-9091-a096c8464738`（Grok 4.5 High）

## 2. Design Summary

- Goal: live 验收改走 chatgpt-codex；保留 openai-responses；四断言不弱化
- Key contracts: D1/D2/D2b（非阻塞 start + 后台 SSE + AbortController）、D4/D5/D7a

## 3. Findings

### blocking

- [x] FDR-R2-001 start 内同步 drain 与 RunSupervisor 冲突 → 已改为 start 立即返回 + 后台 SSE + AbortController

### important

- [x] FDR-R2-002 D7a 表写回正文
- [x] FDR-R2-003 Matrix 补 cancel/timeout 行
- [x] FDR-R2-004 SSE→snapshot 钉死为 extractFromResponse 兼容形；不符进 D1 gate

### nit / suggestion

- [ ] items.yaml notes 过期 — S7 回写（design 已标明）
- [ ] research-task.yaml 仍旧 executor — S3 改
- [ ] refresh rename/竞态 — D2b 已补

### praise / residual-risk

- D1 禁降级/禁弱化四断言/ToS residual 清楚
- 残余：未文档端点、S1 前 annotations 未知、OAuth client id、supervisor timeout 与 D7a 交互（QA 盯）

## 4. User Review Focus

- Owner 已通过改道计划确认接受订阅/ToS residual risk
- implement：非阻塞 start、snapshot 规范化、脱敏、互不降级

## 5. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Acceptance Coverage Matrix | pass | C | 含 S1/S5/S6 | S1 live |
| DoD Contract | pass | C | design §3.y | none |
| Steps/checks traceability | pass | C | checklist | S7 items |
| Roadmap contract compliance | pass | C | 四断言保留 | none |
| Module interface design | pass | C | 非阻塞 start 对齐 seam | impl |
| Validation and artifacts | pass | C | CMD 表 | none |

Summary: E=0, C=6, H=0, H-only core checks=none。

## 6. Residual Risk

未文档端点 / ToS / S1 annotations 未知 / OAuth client id 变更 — D1 gate + owner 已接受计划。

## 7. Verdict

- Status: passed
- Next: design `approved`（owner 计划确认 = ApproveDesign）；进入实现

## 8. Focused Closure

- Closed: FDR-R2-001..004
- Attributed delta: design D2b 非阻塞 start/snapshot/refresh；D7/D7a 表与流程约束；Matrix cancel/timeout；S7 items 过期标注
- Verification: 正文可核对 start 立即返回与 D7a 表
- Classification: 闭合本轮 finding；未弱化四断言或扩大范围
