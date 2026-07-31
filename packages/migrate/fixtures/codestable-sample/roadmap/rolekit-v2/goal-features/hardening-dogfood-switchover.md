---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-27-hardening-dogfood-switchover
roadmap_item: hardening-dogfood-switchover
status: accepted
---

# hardening-dogfood-switchover Goal 执行规格

## 1. Identity And Inputs

- 顺序：11/11
- 依赖：`host-adapter-skills`、`role-profiles-migration`、`verifier-gate-engine`、`research-module`、`evals-fixtures`、`migrate-tool`（全部必须 `done`）
- 性质：`mixed`
- Design：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-design.md`
- Checklist：同目录 `hardening-dogfood-switchover-checklist.yaml`
- Design review：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-design-review.md`
- Implementation review：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-review.md`
- QA：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-qa.md`
- Acceptance：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-gate-results.json`
- DoD results：`.codestable/features/2026-07-27-hardening-dogfood-switchover/hardening-dogfood-switchover-dod-results.json`

## 2. Delivery And Core Path

- 交付：durable Pi steer/active-exit barrier、封闭 recovery/error/integrity、DogfoodPlan/controller/evaluator/ledger/metrics/seal、g00..g07 candidate、单次 promotion 与 SwitchDecision。
- 核心路径：remote-free `rolekit-self` + `ctxline` 隔离 snapshot 上创建固定十个 delegated WI/十一 TaskContract；T0 driver 执行 RK-01..04，product harness 接管 RK-05..07/CTX-01..03；全部 attempts 与两个项目 run/reservation index 并集入账。
- 完成门闩：Envelope/Contract/Integrity 100%；任何 attempt scope violation 永久 hold；RK-01 caller crash、RK-04 g03 3min/300s/60s-margin owner loss+同 task 30min retry、RK-03/RK-05 exact nonce/delivery、RK-06 chatgpt-codex research checker（保留 openai-responses）、CTX patch/review、RK-07 pre-review isolation 均通过；SwitchDecision 必须 `go`。

## 3. Mandatory Commands

- `npm test`
- `node --test test/e2e/`
- `npx tsc --noEmit && npx biome check .`
- `npm run evals`
- `npm run lint:adapters`
- `npm run audit:dogfood -- --campaign-root <path> --campaign <id>`
- `npm run check:switch -- --campaign-root <path> --campaign <id>`
- `cd <ctxline-snapshot> && cargo fmt --check && cargo test --locked && cargo build --release --locked`
- `cd <ctxline-snapshot> && python scripts/smoke.py <binary>`
- `npm run check:research -- <RK-06-runDir>`

动态值必须来自本 campaign sealed raw receipts；旧 campaign、占位符或手填路径不算证据。

## 4. Feature DoD And Gates

- 六项依赖全部 done；S1/D12 batch patch 与 runtime bundle 先按 design 原子冻结，非法 plan 必须零 WI/run 写入。
- Implementation steps、scope/dod/evidence gates passed；Grok 4.5 High 独立 review 不得读取前轮结论，前后全仓 SHA 必须一致。
- QA 必须真实执行 Pi/chatgpt-codex/Windows process tree/ctxline Rust；`openai-responses` 仅保留/可选，非 go 硬依赖；不可用核心能力导致 handoff，不得 mock 替代。
- Acceptance 只在 final CampaignEvaluation/Ledger/Metrics/Seal/SwitchDecision 逐字重算通过且 `go` 时通过；`hold` 不算完成。
- 两授权有效后才写 acceptance/scoped commit；lifecycle cutover（停写 CodeStable / 启用 `.rolekit`）不因 feature accepted 或 SwitchDecision=`go` 自动发生；D7a 的 canonical code/report promotion 按 design 执行，二者不可混称。

## 5. Evidence And Sealing

- 完整采用 checklist `dod.evidence_required`。关键证据至少包括 DogfoodPlan/resolved-plan/runtime overlays、nonce source digest、bootstrap JSONL hash chain、candidate build receipts 与全部 invocation pairs、ProcessIdentity/live receipts、本地 evidence commits、run-content manifests、raw/final evaluation-ledger-metrics、research checker、migration bundle、ctxline patch/review、campaign seal、SwitchDecision 与 roadmap patch。
- `scanRunContent` 是 ledger/seal 唯一内容公式；损坏/null/orphan/duplicate/missing run 保留分母并阻塞。
- Candidate 每次消费重 hash；拒绝 symlink/junction/submodule/PATH/global resolution。intent 可含 native absolute path，但日志/报告只留 digest。
- steer nonce 是公开一次性关联符；promotion 必须排除 campaign-only steer evidence。任何 secret pattern、credential remote、`OPENAI_API_KEY` 值或 ChatGPT access/refresh token 命中即 blocker。

## 6. Deliverables And Cleanliness

- 交付物：steering/recovery production code/tests、dogfood runtime/controller/evaluator、strict raw/canonical artifacts、D12 全量 roadmap/ADR/host supersede patch、单次 aggregate promotion candidate 与 switch report。
- Fixture 只能写独立 temp root；campaign 不得污染主工作区/ctxline source。禁止第二 harness/evaluator/research formula、换 campaign 隐去失败、candidate 自证、双生命周期长期共存、remote push/publish/deploy/cutover。
- campaign sealing 后 raw bytes 只读；canonical 文件必须与对应 raw revision 逐字一致，UTF-8 无 BOM/尾换行按 design 冻结。

## 7. Failure Recovery Boundary

- `set_steering_mode` false/超时/坏响应、owner-loss window missed、candidate/bootstrap/invocation/seal mismatch、任一 scope violation、research checker失败或 RK-07 input 漂移均永久 fail-closed/hold，禁止换 attempt/campaign 隐去。
- 普通实现/review/QA defect 按 feature loop 新 evidence revision 修复；不得改 sealed campaign 或降低阈值。
- 核心凭据/进程/真实项目不可验证、approved design 需变化、独立 reviewer 不可用或同项三轮失败时写 handoff。
