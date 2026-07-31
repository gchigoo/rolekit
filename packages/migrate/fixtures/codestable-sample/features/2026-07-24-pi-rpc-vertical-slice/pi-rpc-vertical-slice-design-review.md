---
doc_type: feature-design-review
feature: 2026-07-24-pi-rpc-vertical-slice
status: passed
review_state: passed
review_reason: ""
reviewer_id: "d625d1fc-e6cf-43d8-9212-7c1aba76bd4a"
reviewed: 2026-07-24
round: 9
---

# pi-rpc-vertical-slice feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-design.md`
- Checklist: `.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-checklist.yaml`
- 对照：最新 verifier / workitem / contract designs、roadmap/items
- 代码事实：greenfield；不因缺源码产生 finding

### Independent Review

- Reviewer: Grok 4.5 High（owner 指定）
- Session: `d625d1fc-e6cf-43d8-9212-7c1aba76bd4a`
- 模式：独立只读；禁止读取本报告；reviewer 前后 checksum 一致
- 历史：多轮闭合 RunManager API、reservation、abort、phase commits、Supervisor、IntegrationManager、D13 与 D15；round 9 focused closure 最终 PASS

## 2. Design Summary

- RunManager 是唯一应用控制面；RunSupervisor 从 starting 起独占 Pi stdio 与 adapter 生命周期。
- reservation 使用 task/attempt index、RFC8785 input digest、initial/retry predecessor 与 crash replay。
- 九值 RunPhase、nullable ManagedRunStatus、deadline/supervisor、report-vs-intent first-committer 及 terminal commit 均已冻结。
- verification 后、任何 branch/awaiting 前冻结 candidate/patch；IntegrationManager 用 binary patch、plan/backup/receipt 实现可恢复门闩。
- D13 统一 minimal/ignore/observe/all-confirm-approved 成功与五种 Envelope 终态。

## 3. Findings Closure

- [x] 完整 RunManager API、受限 `ensureAuditEvent` 与 CLI JSON/错误码冻结。
- [x] RunSupervisor 独占 adapter/stdio，active owner 丢失 fail 为 lost，不盲重启。
- [x] report-vs-intent first-committer 与 gate-pending cancel 例外一致。
- [x] `verifier_mode` 在 loader/digest/run-state 冻结；enhanced manifest 必有并校验，minimal 必无。
- [x] GateContinuation 统一为 minimal / ignore / observe / all-confirm-approved。
- [x] `ensureAuditEvent` 只允许 lane-override observe gate，不能伪造 started/finished。
- [x] reverify 从 baseline+冻结 patch 重建临时 worktree，不覆写原证据或主区。
- [x] D15 4.3/4.5/4.6/4.8 可逐项合入。

## 4. Evidence Confidence Ledger

| Check | Verdict | Basis |
|---|---|---|
| Prepare/retry/abort | pass | D3a-c、reservation 真值表与 crash fixtures |
| Supervisor / timeout | pass | D7、starting/active owner 与 detach 语义 |
| Run-state recovery | pass | D11 九 phase、durable commits、lost/terminal |
| Integration all-or-none | pass | D12 candidate/plan/backup/receipt/checkpoints |
| D13 cross-feature | pass | verifier/WorkItem 单一引用与 GateContinuation |
| CLI / reverify / artifacts | pass | D3/D10/D15、场景与 Matrix |
| Checklist | pass | YAML 校验通过 |

## 5. Residual Risk

- Windows Pi spawn/stdio 稳定性仍需 5 工作日 timebox 实证；fallback 仍是 blocking gate。
- network deny 仍为声明 + 事后审计，不是 sandbox。
- 主区外部进程不遵守 integration lock 的竞态只能 fail-closed，不能控制外部 writer。
- implementation 仍等待 contract-schemas done 与 D15 batch patch 合入。

## 6. Verdict

- **Status: passed**
- Design admission 已通过；不等于 implementation admission。
- Next: 交回 cs-epic 继续剩余 child design。
