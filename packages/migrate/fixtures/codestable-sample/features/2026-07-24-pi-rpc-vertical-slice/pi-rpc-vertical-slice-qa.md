---
doc_type: feature-qa
feature: 2026-07-24-pi-rpc-vertical-slice
status: passed
qa_date: 2026-07-28
reviewer: subagent
---

# pi-rpc-vertical-slice QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-pi-rpc-vertical-slice/pi-rpc-vertical-slice-design.md`（approved）
- Checklist: `pi-rpc-vertical-slice-checklist.yaml`（steps 全 done；checks 仍 pending，归 acceptance）
- Review: `pi-rpc-vertical-slice-review.md`（round 2，status=passed，blocking=0）
- Evidence pack / gate / DoD：均存在；scope-gate passed
- Diff basis：本 feature 工作区改动（runner/cli/scripts/evidence/roadmap）；无无法归因脏文件
- Feature type: functional
- Core evidence gate：四阶段验收（mock 链路 / Pi smoke / inject 双场景 / dogfood 2+1 + verify）+ DoD 五命令必须有真实进程证据

## 2. Verification Matrix

| ID | 来源 | 核心性 | 场景 / 风险 | 证据类型 | 命令或动作 | 期望 | 结果 |
|---|---|---|---|---|---|---|---|
| QA-001 | design 阶段1 | core-functional | Mock 全链路五件产物 | unit | `npm test` RunManager mock | completed + 五件产物 | pass |
| QA-002 | design 阶段2 | core-functional | Pi RPC smoke：probe + message + cancel | run artifacts | evidence/smoke/* | 无 steer；≥1 message；cancel 终态 | pass |
| QA-003 | design 阶段3a | core-functional | forbidden 越界 → failed + gate block | run artifacts | evidence/inject/forbidden | status=failed；scope_violations；gate block | pass |
| QA-004 | design 阶段3b | core-functional | 主区注入 → concurrent-change | run artifacts | evidence/inject/concurrent | failed + concurrent-change: + gate block | pass |
| QA-005 | design 阶段4 | core-functional | dogfood 2 成功 + 1 cancel | run artifacts | evidence/dogfood | 两 completed + 一 cancelled；五件齐全 | pass |
| QA-006 | design 阶段4 / DoD CMD-005 | core-functional | verify 复跑 passed=true | command | `node scripts/verify-dogfood-run.ts` | 两 run passed=true；exit 0 | pass |
| QA-007 | review QA focus | core-functional | cancelled → run_not_verifiable | artifact | dogfood/verify-cancel.json | error=run_not_verifiable | pass |
| QA-008 | DoD CMD-001..004 | core-functional | npm test / tsc / biome / e2e | command | 见 §3 | 全 exit 0 | pass |
| QA-009 | review REV-004 | residual | Integration post digest 自证循环 | diff | integration-manager.ts:146-254 | 未修；记 residual | residual |
| QA-010 | review / design 3a 注记 | residual | forbidden 由 harness 预置非 Pi tool 写 | artifact | inject RESULT + review | 机械信号满足；语义记 residual | residual |
| QA-011 | e2e / review focus | supporting | steer / in-place / usage exit2 / cancel verify | e2e | `node --test test/e2e/` | 全绿 | pass |
| QA-012 | unit / review focus | supporting | finalizer×cancel、abort、timeout | unit | npm test finalizer 套件 | 全绿 | pass |

## 3. Command Results

- `npm test` → exit 0：130 pass / 0 fail（含 mock 闭环、scope/concurrent、finalizer、probe）
- `npx tsc --noEmit` → exit 0
- `npx biome check .` → exit 0（25 warnings，无 error；与 evidence pack 一致）
- `node --test test/e2e/` → exit 0：43 pass（validate + run/verify mock）
- `node scripts/verify-dogfood-run.ts` → exit 0：
  - `run-20260728-083328-7678: passed=true`（reverify `...09-25-07-947Z.json`）
  - `run-20260728-083359-a14d: passed=true`（reverify `...09-25-08-986Z.json`）

## 4. Scenario Results

- [x] QA-001 阶段1 Mock 全链路：pass
  - Evidence: `RunManager mock closed loop` 六测全绿；成功路径 completed + 五件产物断言
- [x] QA-002 阶段2 Pi smoke：pass
  - Evidence: `evidence/.../smoke/RESULT.md` status=passed；`probe.json` capabilities 无 steer；`prompt-events.jsonl` 含 `type=message` text=pong；`cancel-live.json` terminal_status=cancelled；D2 fallback 未触发
- [x] QA-003 阶段3a forbidden：pass
  - Evidence: adapter=`pi-rpc`；`result.json` status=failed；`scope_violations=["forbidden:forbidden-out.txt"]`；events `gate/action:block`；SUMMARY forbidden=true
- [x] QA-004 阶段3b concurrent：pass
  - Evidence: `scope_violations=["concurrent-change: added src/seed.txt"]`；gate block；措辞无 worker 归因；SUMMARY concurrent=true
- [x] QA-005 阶段4 dogfood 2+1：pass
  - Evidence: runs `083328-7678`/`083359-a14d` status=completed、verification.passed=true；`083504-367e` status=cancelled；各 run 含 task.json/prompt.md/events.jsonl/result.json/verification.json
- [x] QA-006 verify passed=true：pass
  - Evidence: 本轮 CMD-005 双 run `passed=true`；最新 reverify artifact `verification.passed=true`
- [x] QA-007 cancelled 拒绝复跑：pass
  - Evidence: `verify-cancel.json` → `{"error":"run_not_verifiable",...}`；e2e `cancel run rejects verify`
- [x] QA-008 DoD 基线命令：pass
- [x] QA-011/012 CLI 错误路径与 finalizer：pass

## 5. Findings

### failed

- none

### blocked

- none

### residual-risk

- REV-004：`fillPostDigests` 从主区读实际 bytes 再 `verifyPost` 同路径比对，属自证循环；`integration-result.post_digest` 仍为 plan JSON 哈希。apply 后部分损坏难机械检出。不阻塞四阶段核心出口，须进 acceptance residual；建议 apply 前从候选 worktree 预填期望 post digest。
- 阶段 3a：forbidden 文件由 inject harness 在 prepare 后/start 前写入 worktree，非 Pi tool 实写；真实 Pi 会话与 scope gate 仍完整。若验收要求语义完整「executor 写出」，需补一次 Pi 实写证据。
- biome 25 warnings（多为 noNonNullAssertion）；exit 0，不阻塞。
- archguard / meta_cc unavailable（非 blocking）。
- checklist `checks` 仍全部 pending——acceptance 机械勾选，不得以 steps.done 代替。

## 6. Cleanliness

- Debug output: pass（packages 内无 console.log/debug；事件走 events.jsonl）
- Temporary TODO/FIXME/XXX: pass（packages 检索无命中）
- Commented-out code: pass
- Unused imports / dead code from this feature: pass（biome exit 0）
- Out-of-scope files: pass（与 scope-gate allowed_prefixes 对齐；无 adapters/profiles/migrate/evals）

## 7. Verdict

- Status: passed
- Blocking: 0
- Core gaps: 0（四阶段 + DoD 五命令均有本轮真实进程/产物证据）
- Next: `cs-feat` acceptance 阶段；acceptance 须勾 checklist checks，并显式记录 REV-004 与 3a harness 语义 residual
