---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-pi-rpc-vertical-slice
roadmap_item: pi-rpc-vertical-slice
status: pending
---

# pi-rpc-vertical-slice Goal 执行规格

## 1. Identity And Inputs

- 顺序：2/11
- 依赖：`contract-schemas`（必须 `done`）
- 性质：`mixed`
- Design：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-design.md`
- Checklist：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-review.md`
- QA：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-qa.md`
- Acceptance：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-dod-results.json`

## 2. Delivery And Core Path

- 交付：RunManager/RunSupervisor、ExecutorAdapter、Mock/PiRpcExecutor、strict JSONL、worktree/reservation、verification/integration、run state/artifacts 与 `rolekit run|verify`。
- 核心路径：Mock 全链路；Windows Pi probe+prompt；越界/主区变化被阻断；真实项目同契约连续 2 次成功 + 1 次 cancel，五件产物与 D13 Envelope 完整。
- Pi framing 禁止 Node `readline` 对 U+2028/U+2029 分行；integration 与 finalizer/cancel 必须可崩溃恢复且单一 winner。

## 3. Mandatory Commands

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`
- `rolekit verify <run-id>`

`<run-id>` 必须来自真实 receipt；静态占位、mock-only 或复制旧 run 不算证据。

## 4. Feature DoD And Gates

- 依赖严格 done；implementation steps、scope/dod/evidence gates 全 passed。
- Grok 4.5 High 独立 review；QA 必须运行真实 Windows/Pi、deadline、race/crash 与 scope 场景。
- Acceptance 复核 `run_state`、reservation index、snapshots、digests、supervisor timeout、finalizer/cancel race、abort/crash recovery。
- 仅在 acceptance 与 `goal-commits` 均有效后 scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 必需证据完整采用 checklist：command output、run artifacts/state、reservation index、snapshots、digest golden、timeout/race/abort/crash recovery、diff summary、roadmap patch。
- 交付物限 runner/CLI/worktree/verification/integration/run artifacts/tests 与 D15 roadmap patch。
- 不保留临时 worktree/process/lock/debug log；不把凭据或 prompt 正文泄露到不允许的 artifact。

## 6. Failure Recovery Boundary

RPC capability/version 不兼容按 design 的 timebox/fallback gate处理，不得私改 seam；race/恢复缺 exactly-once 证据、真实 Windows/Pi 不可验证、需改上游 schema 或同项三轮失败时 handoff。
