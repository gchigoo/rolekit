---
doc_type: feature-review
feature: 2026-07-24-host-adapter-skills
status: passed
reviewer: subagent
reviewed: 2026-07-28
round: 2
lane_a_state: completed
lane_a_ref: ""
lane_a_reason: ""
lane_b_state: unavailable
lane_b_ref: ""
lane_b_reason: "ocr CLI present but ocr llm test failed: no valid LLM endpoint configured"
---

# host-adapter-skills 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-design.md`（`status: approved`）
- Checklist: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-checklist.yaml`（`steps` 全 `done`；`checks` 留给 acceptance）
- Evidence pack: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-gate-results.json`（`passed`）
- DoD results: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-dod-results.json`（`passed`，CMD-001..004 exit 0；CMD-004 走 authentic extract 路径）
- Prior review: round 1 `changes-requested`（blocking REV-001/002；important REV-003 等）
- Diff basis: 工作区未提交改动——`adapters/**`、extract/check/lint/validate/install scripts、`test/adapters/**`、`evidence/host-adapter-skills/**`、package/CI/biome/gitignore、feature gate/DoD/evidence 产物
- Review mode: full-rereview（Material：review-fix 引入 extract 路径与 live fail-closed，属实质行为变化）
- Baseline dirty files: none（当前 dirty 均可归因本 feature）
- Model: Grok 4.5 High（独立只读 subagent）

### Independent Review

- Detection: 本报告由独立 Task agent（subagent）完成；`ocr` 二进制存在但 `ocr llm test` 失败（无 LLM endpoint）
- 环节 A 独立隔离 Task agent: independent-agent + completed
- 环节 B OCR CLI: unavailable
- OCR severity mapping: High→blocking/important, Medium→nit/suggestion, Low→discarded
- Merge policy: 本文件即为独立 reviewer 定稿；OCR 未参与
- Gate effect: `reviewer: subagent` 满足默认 gate

## 2. Diff Summary

- 新增：`adapters/{shared,pi,cursor,codex}/**`、`scripts/{lint-adapters,check-delegated-run,check-delegation-live,extract-pi-session,extract-cursor-session,validate-adapter-artifact,install-skill,host-adapter-evidence}*`、`test/adapters/**`（含 `pi-positive.jsonl`）、`evidence/host-adapter-skills/**`（含 pi `session.jsonl`、cursor `session.raw.json` + `_raw_capture/`）、feature DoD/gate/evidence 产物
- 修改：`package.json`、`.github/workflows/ci.yml`、`scripts/run-tests.ts`、`.gitignore`、`biome.json`、checklist、`goal-state.yaml`
- 删除：none
- 未跟踪 / staged：adapters/evidence/scripts/test 与 feature 产物多为 untracked；无 staged
- 风险热点：D5 证据真实性、extract 与 checker 对齐、live fail-closed 是否可绕过

## 3. Adversarial Pass

- 假设的生产 bug：Cursor `session.raw.json` 为手写结构化摘要，机械门闩仍绿，但并非宿主原生聊天导出
- 主动攻击过的反例：
  - design 不一致：用毒化 pi jsonl（extract 失败 / Available 外命令）复验 live——均 exit 1，且出现 `FAKE-GREEN blocked`
  - 错误路径：`looksLikeRolekitFailure` 已收窄到 rolekit exit 标记，不再被宿主 timeout / SKILL 正文误伤
  - 测试假阳性：`pi-positive.jsonl` fixture 覆盖 jsonl 形态；cursor raw 尚无平行 fixture
  - 真实性：cursor 全事件同一 `ts`，format=`cursor-agent-session-export/v1`；但 `_raw_capture/*.json` stdout 与 raw events 逐条匹配，run_id 与 run-dir 一致
- 结果：round 1 blocking 关闭；Cursor 格式等价性进入 residual-risk / important，不升级为新 blocking

## 4. Findings

### blocking

none

### Closure Of Prior Findings

- [x] REV-001 Cursor 原始导出缺口 — **closed**（independent-agent）
  - Evidence: `evidence/host-adapter-skills/cursor/session.raw.json` 存在；`node scripts/check-delegated-run.mjs …/session.raw.json …/run-dir` → pass `source=cursor-raw-json`；live DoD 主路径 authentic=raw → extract → `session.export.md` 再检；`_raw_capture/{compile,start,...}.json` stdout 与 raw events 一致。
  - Note: 该 raw 为项目约定结构化导出（非 Cursor 原生 chat transcript）；见 residual-risk。

- [x] REV-002 DoD 未作用真实 Pi 导出 — **closed**（independent-agent）
  - Evidence: `resolveAuthenticSession('pi')` 强制 `session.jsonl`；checker 对 `.jsonl` 走 `extract-pi-session`；`node scripts/check-delegated-run.mjs …/session.jsonl …` → pass；毒化 jsonl 后 live exit 1 且打印 `pi: FAKE-GREEN blocked — session.md passes but authentic export fails`。

- [x] REV-003 checker 无法消化真实 Pi jsonl — **closed**（independent-agent）
  - Evidence: `extract-pi-session.mjs` 只取 bash toolCall/toolResult，忽略 SKILL 正文与 user 命令表；`looksLikeRolekitFailure` 替代宽泛 failure；`extractOneRolekitCommand` 有界抽取；`test/adapters` 含 `pi-positive.jsonl` 与 extract 单测；`npm test` 135 pass。

### important

- [ ] REV-004 `adapters/shared/command-map.mjs` 与 `command-map.md` 仍双源（AVAILABLE 枚举未从 md 派生 / 无双向一致性断言）
  - Evidence: 同 round 1；本轮未修。
  - Impact: D4 防漂移主路径仍有手滑裂缝。
  - Expected fix scope: md 派生或 lint 双向一致；可延后至 acceptance 前由 owner 决定。

- [ ] REV-005 Pi 委派提示词仍枚举完整命令链（`session.jsonl` user message）
  - Evidence: 同 round 1；extract 已忽略 user 列表，但触发可靠性证据仍偏弱。
  - Impact: Top 风险#1 未覆盖；机械 D5 可通过。
  - Expected fix scope: QA 用意图型提示复核至少一宿主，或明确接受局限。

- [ ] REV-006 evidence pack §5 仍写 `Residual Risks: none`，未记录 Cursor 结构化导出 vs 原生聊天导出的真实性差距
  - Evidence: `host-adapter-skills-evidence-pack.md` §5；gate/DoD `warnings: []`。
  - Impact: QA 易被「全绿」误导。
  - Expected fix scope: residual / warnings 写明 Cursor raw 为约定格式 + `_raw_capture` 交叉核验口径。

### nit

- [ ] REV-007 `scripts/extract-pi-session.mjs:108` biome `useOptionalChain` warning（CMD-002 仍绿，属既有 warnings 池增量 1 条）
- [ ] REV-008 checklist S5 / `WRITEBACK-NOTES.md` items.yaml 仍 defer 到 acceptance（与 round 1 REV-009 同类，不阻塞本轮 code review）

### suggestion

- [ ] REV-009 为 cursor raw JSON 增加 fixture 正例；为 `check-delegation-live` fail-closed 增加可重复脚本/测试（当前靠手工毒化验证）
- [ ] REV-010 ARCHIVE/POINTER 可附 Cursor agent transcript 路径，降低下次取证成本

### learning

- D5 机械门闩必须以宿主原始导出为一等公民，清洗 `session.md` 只能作附录；fail-closed（authentic 红 + sanitized 绿 → 失败）是验收可信度的关键不变量。
- Pi jsonl 与 Cursor 约定 raw JSON 证据强度不对等：前者有宿主指纹（toolCall id、encrypted reasoning、递进 timestamp），后者依赖结构化声明 + CLI capture 交叉核对。

### praise

- review-fix 正确把门闩从「清洗稿优先」翻转为「authentic → extract → checker」，并落地两宿主 extract 脚本与 live 编排。
- Pi 侧 extract 明确排除 user 命令表与 SKILL 回显，直接击穿 round 1 假绿根因。
- `lint:adapters` + CI、`npm test` 含真实 jsonl 形态 fixture；三份 Skill 仍远低于 200 行且禁词零命中。

## 5. Test And QA Focus

- QA 必须重点复核：
  - `node scripts/check-delegation-live.ts`（两宿主 authentic + extract + fail-closed）
  - 直接对 `pi/session.jsonl` 与 `cursor/session.raw.json` 跑 `npm run check:delegation`
  - `npm run lint:adapters`、`node scripts/validate-adapter-artifact.ts`、skill sha256 对照
  - 意图型提示（不枚举命令）下至少一宿主能否仍按 Skill 完成链
  - Cursor：确认委派确由加载 Skill 的 Cursor agent 发起，而非仅 CLI 手工链 + 事后拼 raw
- Evidence pack residual risks：仍写 none——**未解释** Cursor 格式等价性；交给 QA / acceptance 对照 REV-006
- 建议新增测试：cursor-raw fixture；live fail-closed 自动化
- 不能靠 review 完全确认的点：Cursor 结构化 raw 是否由真实 agent 会话生成；items.yaml 最终 writeback 时点

## 6. Residual Risk

- Cursor `session.raw.json` 为 `cursor-agent-session-export/v1` 约定格式，全事件同一时间戳；已用 `_raw_capture` stdout 与 run_id 交叉核验，满足 round 1「等价可机械核验」关闭条件，但弱于 Pi 原生 jsonl。QA 应区分「run 真实性」与「经 Skill 驱动」叙事强度。
- biome warnings 主要在既有 `packages/runner`；本 feature 新增 1 条 optional-chain warning，不升级为 blocking。
- OCR lane unavailable（无 LLM endpoint）：行级扫描未跑；本轮以独立 subagent 全量行级审查替代，不阻塞 `reviewer: subagent`。

## 7. Verdict

- Status: passed
- Blocking count: 0
- Closed this round: REV-001, REV-002, REV-003
- Open important (non-blocking): REV-004, REV-005, REV-006
- Next: Goal lane → QA（`cs-feat` QA 阶段）；important 是否先修由 owner 决定，未修须带入 QA residual risk
- Path: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-review.md`

## 8. Focused Closure（无则写 none）

none（本轮为 Material 完整独立复审，非 focused closure）
