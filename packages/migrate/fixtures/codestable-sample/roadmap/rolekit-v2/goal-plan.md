---
doc_type: roadmap-goal-plan
roadmap: rolekit-v2
status: ready-to-dispatch
created: 2026-07-27
baseline_ref: no-git
---

# RoleKit v2 Goal 执行总览

## 1. Inputs And Authorization

- Roadmap：`.codestable/roadmap/rolekit-v2/rolekit-v2-roadmap.md`
- Items：`.codestable/roadmap/rolekit-v2/rolekit-v2-items.yaml`
- State：`.codestable/roadmap/rolekit-v2/goal-state.yaml`
- Owner 已确认 roadmap 和全部 11 份 feature design；11/11 design approved、design-review passed。
- 当前目录不是 Git 仓库，故 package baseline 依法记录为 `no-git`，没有伪造 SHA。
- Goal execution 已于 2026-07-28 以 `confirmation_id=rk-v2-goal-exec-20260728-a1` 原子批准；分别机械核验 `approval-report.md#goal-acceptance` 与 `approval-report.md#goal-commits`。

## 2. Feature Execution Order

1. `contract-schemas` — 建立 TypeScript monorepo 基线、9 类 TypeBox schema、JSON Schema 导出与 `rolekit validate`（mixed）
2. `pi-rpc-vertical-slice` — 交付 RunManager/RunSupervisor、Pi RPC/Mock executor、worktree、verification、integration 与 run CLI 最小闭环（mixed）
3. `host-adapter-skills` — 交付 pi/codex/cursor 三份薄入口并证明至少两个宿主经同一 CLI 委派（functional）
4. `role-profiles-migration` — 交付 7 份 RoleProfile、编译结果及 implementer/reviewer/researcher 真实 run（mixed）
5. `verifier-gate-engine` — 交付 RoleKit 原生 PolicyEngine、verifier/gate、revision/manifest 与 gate CLI（mixed）
6. `evals-fixtures` — 交付 `evaluateRun` 单一事实源、严格 fixture 与 `npm run evals`（non-functional）
7. `research-module` — 交付 `chatgpt-codex`（订阅）+ 保留 `openai-responses`、research profile、报告/activity/citation 四断言（mixed）
8. `workitem-lifecycle-core` — 交付 WorkItem 状态机、lane、gate/question/recovery 与 `rolekit workitem` 命令面（functional）
9. `knowledge-layer` — 交付四类 KnowledgeEntry、store/search、active-rule prompt snapshot（functional）
10. `migrate-tool` — 交付 CodeStable/Superpowers fresh-target 迁移、完整 mapping/provenance/semantic fidelity（functional）
11. `hardening-dogfood-switchover` — 完成 steer/recovery 硬化、两真实项目十 WI dogfood、strict evaluation/seal 与 switch decision（mixed）

顺序严格采用 workflow hook 的 `topological_order`。Design admission 曾允许依赖仅 review passed；实现前仍要求当前 item 的全部依赖严格 `done`。

## 3. Roadmap Core Acceptance Paths

1. **Contract/CLI**：9 类 schema 每类至少 1 正例 + 2 负例，经真实 `rolekit validate` 判定且 JSON Schema 导出幂等。
2. **Runner/Pi**：Mock 全链路、Windows Pi RPC smoke、真实项目连续 2 次成功 + 1 次 cancel，五件 run 产物完整。
3. **Scope/integration**：worktree 越界与主工作区基线变化被集成前阻断，Envelope 状态语义正确。
4. **Host adapters**：至少两个宿主由薄 Skill 驱动同一 CLI，各产生至少一个可审计 delegated run。
5. **Profiles**：7 profile 全部校验/编译；implementer、reviewer、researcher 各完成真实 run。
6. **Verifier/gates**：合规 run 无人工 gate 且有 observe 审计；越界 run 在 integration 前 block。
7. **WorkItem**：create→next→start→done 命令闭环，非法转移 exit 1；question/recovery/gate CAS 证据可重放。
8. **Migration**：本仓库 CodeStable 与 Superpowers 样本按完整源清单迁移，未知/skip/merge/fingerprint/target_id 全部机械记账，源零写。
9. **Dogfood/switchover**：`rolekit-self` + `ctxline` 固定十个 delegated WI，全部 attempts 入分母；Envelope/Integrity 100%、scope violation 0、RK-01/RK-04 live receipts、RK-03/RK-05 steer、RK-06 research、RK-07 自举均通过；SwitchDecision 必须 `go`。
10. **Research（非 roadmap core 但不可跳过）**：真实 `chatgpt-codex` run 通过 report/activity/citation/检索记录四断言。
11. **Evals/knowledge（非 roadmap core）**：`npm run evals` 全绿；rule 注入与四类 KnowledgeEntry 校验/检索正确。

该 roadmap 无 UI/Web 核心路径；证据以真实 CLI、进程、文件字节、run artifacts、git/snapshot diff 与机械断言为准，不能用静态文档替代。

## 4. Key Assumptions

- Node `>=22.18`、npm、Git、Windows process APIs 与兼容 Pi RPC 可用；ctxline 另需 Rust 1.85+ 与 Python。
- Pi JSONL 使用 LF 严格 framing，不以 Node `readline` 错分 `U+2028/U+2029`。
- research live 走 `chatgpt-codex`：读 `ROLEKIT_CHATGPT_AUTH_FILE` 或 `~/.codex/auth.json`；`openai-responses` 仍可读 `OPENAI_API_KEY`。缺 auth/annotations 是 RK-06 核心 blocker，禁止降级 Pi 或落盘 token/key。
- `D:/Personal/ctxline` 仅作为固定 commit 的 remote-free snapshot 来源；不得复制其 credential-bearing remote。
- 当前 `baseline_ref=no-git` 是真实环境事实；没有 Goal commit 授权前不得初始化 Git 或创建提交。

## 5. Top 3 Risks And Mitigations

1. **Greenfield + no-git baseline**：首项前复核目录；若仍无 Git，只有 `goal-commits` 明确批准后才可在本地初始化，并把首 feature 的完整状态作为首个 scoped commit；未批准、初始化失败或无法证明 clean 时 handoff，绝不伪造 commit/baseline。
2. **Windows/Pi 并发恢复错误**：真实进程 identity、strict JSONL、deadline winner、steer barrier、caller crash/owner loss fault matrix 均须跑；同一失败三轮或核心进程证据不可得即 handoff。
3. **迁移/dogfood 证据污染或自证循环**：remote-free 隔离 snapshot、controller invocation pair、g00..g07 generation、bootstrap hash chain、单一 `scanRunContent/evaluateCampaign`、全部 attempts 分母与 scope 口径 B fail-closed；禁止凭据、换 campaign、fixture 假扮真实任务或 candidate 自证。

## 6. Mandatory Validation Commands By Feature

### contract-schemas

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`

### pi-rpc-vertical-slice

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`
- `rolekit verify <run-id>`

### host-adapter-skills

- `npm run lint:adapters`
- `npx biome check .`
- `rolekit validate <artifact>`
- `npm run check:delegation -- <session> <run-dir>`

### role-profiles-migration

- `npm run validate:profiles`
- `npm test`
- `npx tsc --noEmit && npx biome check .`
- `rolekit validate <run-artifact>`

### verifier-gate-engine

- `npm test`
- `node --test test/e2e/`
- `npx tsc --noEmit && npx biome check .`
- `rolekit validate <artifact>`

### evals-fixtures

- `npm test`
- `npm run evals`
- `npx tsc --noEmit && npx biome check .`

### research-module

- `npm test`
- `node --test test/e2e/`
- `npx tsc --noEmit && npx biome check .`
- `npm run check:research -- <runDir>`
- `rolekit validate <artifact>`

### workitem-lifecycle-core

- `npm test`
- `node --test test/e2e/`
- `npx tsc --noEmit && npx biome check .`
- `rolekit validate <artifact>`

### knowledge-layer

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`
- `rolekit validate <knowledge.md>`

### migrate-tool

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`
- `npm run validate:migrations`

### hardening-dogfood-switchover

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

所有尖括号参数必须由该 feature 的 raw receipt/manifest 在运行时解析；保留占位符的命令不算执行证据。

## 7. Final Aggregate Commands

```text
npm test
npx tsc --noEmit
npx biome check .
node --test test/e2e/
npm run evals
npm run lint:adapters
npm run validate:profiles
npm run validate:migrations
npm run audit:dogfood -- --campaign-root <sealed-campaign-root> --campaign <campaign-id>
npm run check:switch -- --campaign-root <sealed-campaign-root> --campaign <campaign-id>
npm run check:research -- <RK-06-runDir>
cd <ctxline-snapshot> && cargo fmt --check && cargo test --locked && cargo build --release --locked
cd <ctxline-snapshot> && python scripts/smoke.py <binary>
python C:/Users/steven.guo/.agents/skills/cs-onboard/tools/codestable-goal-consistency-gate.py --roadmap .codestable/roadmap/rolekit-v2
```

最终审计须从 sealed campaign/raw receipts 解析所有动态路径后执行，不得把占位文本、先前 campaign 或 trust-prior 当作 hardening 核心证据。

## 8. Preflight Strategy

1. 每个 feature 进入前运行 workflow hook 的 feature implementation-ready gate；依赖必须严格 `done`。
2. 首项复核 `baseline_ref`、Git 状态、Node/npm 与当前目录；no-git 不得伪装为 SHA。若 goal-commits 已批准，可按第 5 节建立本地 Git；否则 handoff。
3. 基线命令不存在是 greenfield 首项的预期，但只能由 approved checklist 建立真实 package/dependency/runner；已有命令红灯必须先归因。
4. 外部 Pi/OpenAI/Rust/Python/Git 能力先 probe；凭据值不得出现在报告、manifest、stdout 或 invocation intent。
5. 每个 feature 只读对应 goal-feature/design/checklist 与当前代码，禁止用后续 hardening 需求向前扩 scope；需要改变 approved contract 时 handoff 回 design。

## 9. DoD Policy

- Design：approved + 独立 design-review passed。
- Implementation：checklist steps 全 done；scope-gate、dod-runner、evidence-pack passed；core commands 使用真实 runner。
- Review：独立 Task agent 同时通过 spec compliance 与 code quality，无 unresolved blocking。
- QA：覆盖 Acceptance Matrix、DoD、review focus、residual risks；功能核心路径必须真实运行。
- Acceptance：仅凭 `goal-acceptance` ApprovalRef；checks 全 passed，items/architecture/requirements 写回完成。
- Feature done：状态/index 持久化后复核 `goal-commits`，scoped commit 成功且工作树 clean。
- Roadmap done：11 feature accepted、items terminal、aggregate commands、consistency/audit gates 与 `goal-audit.md` 全部 passed。

## 10. Gate Policy

- 运行时权威：`goal-protocol-gates.md` 与 repo-local `.codestable/gates/roadmap-goal-gates.yaml`。
- `implementation.before_review` 必跑 skill 包真实 `scope-gate`、`dod-runner`、`evidence-pack`；缺脚本即安装/runtime blocker。
- Review/QA/acceptance 的 protocol-only gate 由对应 skill 消费 artifacts，不伪造 executable result。
- 最终必跑 `codestable-goal-consistency-gate.py` 与 goal-audit gate；同一 blocking 三轮失败或需改 approved contract 时 handoff。
- Scope、candidate、ledger、seal、research、live-process 等 hardening blocker 均 fail-closed。

## 11. Provider Policy

- archguard / meta-cc unavailable：记录 fallback，不自动阻塞；其 warning 必须由 review、QA 或 audit 解释。
- Owner 已冻结所有后续 subagent/reviewer 使用 Grok 4.5 High；显式配置不可用或调用失败时 fail-closed，不得降级本地 self-review。
- 独立 reviewer 必须可观察、只读受控；完成后核验项目未被其修改。
- Provider warning 若影响核心判断、凭据边界或真实运行证据，则 blocking。

## 12. Missing Verification Tool Recovery

- 只允许安装/锁定 design 声明的真实依赖、lockfile 或修复既有 package/test/runner 配置。
- 禁止创建与 node/npm/pi/git/cargo/python/test framework 同名的 shim、always-green 命令、第二套 campaign evaluator 或第二套 research assertion。
- 核心工具/账户/真实进程不可恢复时 `NeedsHuman` 或 handoff；只有非核心验证才可带明确理由 skip。

## 13. Final Audit Evidence

最终审计核验每个 feature 的 approved design、checklist、review、QA、acceptance、evidence pack/results、gate/DoD results、命令原始输出、artifact inventory、provider warnings、E/C/H summary、H-only core checks、scoped commits 与 writebacks。

必须运行：

```text
python C:/Users/steven.guo/.agents/skills/cs-onboard/tools/codestable-goal-consistency-gate.py --roadmap .codestable/roadmap/rolekit-v2
```

`goal-audit.md` 或 `goal-evidence-summary.md` 必须聚合 provider warnings、final aggregate commands、E/C/H summary 与 H-only core checks；核心完成不得只靠 H-only evidence。

## 14. Authorization Effects

### goal-acceptance

批准后，Goal driver 可在每个 feature 的 review 与 QA 均 passed、证据门闩通过后，调用 `ResumeGoalAcceptance` 写 acceptance、把 checklist checks 标 passed，并回写 roadmap/architecture/requirements。它不授权改变 approved design 或跳过核心证据。

### goal-commits

批准后，Goal driver 可按 feature 创建本地 scoped commit，范围仅含该 feature 的代码、spec/review/QA/acceptance、实际 writeback 与对应 goal-state 更新。当前 `baseline_ref=no-git`；若批准时仍非 Git 仓库，该决定同时允许为实现这些本地 scoped commits 执行一次 `git init`，但不允许配置/复制 credential-bearing remote。

两项授权都不包含 remote push、merge、publish、release、deploy、promotion 或 production cutover；这些动作始终需要独立 owner authorization。
