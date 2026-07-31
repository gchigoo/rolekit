---
doc_type: feature-qa
feature: 2026-07-27-hardening-dogfood-switchover
status: passed
tested: 2026-07-29
round: 3
---

# hardening-dogfood-switchover QA

## 结论

D9 证据修复后 `audit:dogfood` pass、`check:switch` **go**；`npm test` 271/271；evaluator 相对 `bb4f5c2` 未削弱。

## 验证

| ID | 项 | 结果 |
|---|---|---|
| QA-001 | `npm test` | pass 271/271 |
| QA-002 | campaign-predicates fail-closed | pass |
| QA-003 | `audit --campaign-root C:\rk\hd` | pass；live_evidence 3/3；qualifying_code_test=7；gates=10 |
| QA-004 | `check:switch --canonical-root` | go；blockers=[] |
| QA-005 | REV-001 patch_qualifies | pass |
| QA-006 | REV-002 steer D9 形态 | pass（RK-03 continue / RK-05 write_exact） |
| QA-007 | REV-003 caller/owner 七文件+ProcessIdentity | pass |
| QA-008 | REV-004/005 三 sha + gates | pass；staging≡canonical |

## SwitchDecision

- verdict: go
- campaign_evaluation_sha256: `36be17fc762a86c1ae152f4cccc6afa029a79f5b07d94c16b0ebdf9d5dd39c00`
- ledger_sha256: `d2cace673068f57339f93af8c55b9d3d8a625b189828e613631387c7b78120c4`
- metrics_sha256: `3383f959a059afb419e2a09b63c2a0af9c223e2b650edfb2a5e46c0199c155cb`

## 证据修复要点

- steer control/events 对齐 D9 消息形态；delivery 字节原已合约
- caller-process：meta pid/start + bootstrap argv_sha256；supervisor spawn argv 可复算（g03 交叉验证）
- owner-loss：七文件 + `owner-loss-retry`；ProcessIdentity 取自 supervisor.json / executor-control.started
