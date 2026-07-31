---
doc_type: feature-acceptance
feature: 2026-07-27-hardening-dogfood-switchover
status: passed
accepted: true
date: 2026-07-29
confirmation_id: rk-v2-goal-exec-20260728-a1
---

# hardening-dogfood-switchover Acceptance

## 裁定

**通过**。evaluator 修复（`bb4f5c2`）+ r2 PASSED 后，D9 live steer/live-evidence 诚实修复并 re-promote；独立审查 r3 PASSED；SwitchDecision=**go**。

## 依据

- 产品：`bb4f5c2`（evaluator）+ `4e3932e`（r2 docs）+ 本轮 acceptance 提交
- `npm test`：271/271
- `audit:dogfood`：pass
- `check:switch`：go；三 RFC8785 sha 与 staging/canonical 一致
- 独立审查 r3：PASSED（`98aa086f-0b8c-43f5-b4e6-b478c7ccbe8f`，cursor-grok-4.5-high-fast）

## SwitchDecision

- campaign_id: `rk-v2-hd-20260729`
- verdict: go
- campaign_evaluation_sha256: `36be17fc762a86c1ae152f4cccc6afa029a79f5b07d94c16b0ebdf9d5dd39c00`
- ledger_sha256: `d2cace673068f57339f93af8c55b9d3d8a625b189828e613631387c7b78120c4`
- metrics_sha256: `3383f959a059afb419e2a09b63c2a0af9c223e2b650edfb2a5e46c0199c155cb`

## 边界

- go ≠ lifecycle cutover；cutover 需另授权
- D9(a)/(b) 完整 OS-wait/candidate 绑定仍为结构谓词（r2 important；不阻塞本轮 go）
