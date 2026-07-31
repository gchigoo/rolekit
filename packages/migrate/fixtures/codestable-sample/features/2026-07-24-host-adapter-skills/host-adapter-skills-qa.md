---
doc_type: feature-qa
feature: 2026-07-24-host-adapter-skills
status: passed
qa_date: 2026-07-28
reviewer: subagent
runner_state: completed
runner_reason: ""
runner_id: ""
tested: 2026-07-28
round: 1
model: Grok 4.5 High
---

# host-adapter-skills QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-design.md`（`status: approved`）
- Checklist: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-checklist.yaml`（`steps` 全 `done`；`checks` 仍 pending，留给 acceptance）
- Review: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-review.md`（`status: passed`，blocking=0；open important REV-004/005/006）
- Evidence pack: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-gate-results.json`（`passed`）
- DoD results: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-dod-results.json`（`passed`；本轮独立重跑 CMD-001..004 均 exit 0）
- Diff basis: 本 feature 可归因改动为 `adapters/**`、委派/extract/lint/validate/install scripts、`test/adapters/**`、`evidence/host-adapter-skills/**`、package/CI/biome/gitignore、feature gate/DoD/evidence/review 产物；`packages/cli` 零 diff
- Baseline dirty files: none（当前 dirty/untracked 均可归因本 feature）
- Feature type: functional（宿主经薄 Skill 驱动真实 CLI 委派 run；改变 agent 操作路径）
- Core evidence gate:
  - Pi / Cursor 委派 run 证据三件套（产物 validate + authentic check:delegation + skill sha256/git rev）
  - `lint:adapters` 四断言
  - `check:delegation` fixture 正负例（进 `npm test` / `test/adapters`）
  - 升级路径 error 后行为（checker 机械断言；本轮毒化 OOS 命令 exit 1）
- Model: Grok 4.5 High（独立只读 QA subagent；本地重跑 DoD，不改代码）

## 2. Verification Matrix

| ID | 来源 | 核心性 | 场景 / 风险 | 证据类型 | 命令或动作 | 期望 | 结果 |
|---|---|---|---|---|---|---|---|
| QA-001 | design S1 | core-functional | Pi 委派 run 证据三件套 | e2e + command | `validate-adapter-artifact` + `check:delegation` on `session.jsonl` + skill-version | 五件产物过校验；authentic pass；sha256 对齐当前 SKILL | pass |
| QA-002 | design S2 | core-functional | Cursor 委派 run 证据三件套 | e2e + command | 同上，对 `session.raw.json` + `_raw_capture` 交叉核 | authentic pass；stdout/exit 与 capture 一致；run_id 对齐 | pass |
| QA-003 | design S3–S6 / CMD-001 | core-functional | 正选/行数/禁词/零 diff | command | `npm run lint:adapters` | exit 0；产物 ≤200 行；禁词零命中 | pass |
| QA-004 | design S8 | core-functional | check:delegation 1 正 + 2 负 + pi-jsonl | unit | `node --test test/adapters/check-delegated-run.test.ts` | 5/5 pass | pass |
| QA-005 | design S7 / review | core-functional | 升级路径不自行决策 | command + manual | 毒化 `workitem list` 进 jsonl 后 check:delegation | exit 1，报 outside Available | pass |
| QA-006 | design / CMD-002 | supporting | biome | command | `npx biome check .` | exit 0（既有 warnings + extract optional-chain） | pass |
| QA-007 | design / CMD-003 | core-functional | 两宿主 run 产物 validate | command | `node scripts/validate-adapter-artifact.ts` | 两宿主 task/events/result ok；prompt/verification 形态检查 ok | pass |
| QA-008 | design / CMD-004 / review focus | core-functional | live authentic→extract→fail-closed | command | `node scripts/check-delegation-live.ts` | pi jsonl + cursor raw 均 pass；extracted 附录亦 pass | pass |
| QA-009 | design 反向 / 范围 | supporting | 无新 CLI / 无 MCP / 无 symlink 安装器 | diff | `git status packages/cli`；adapters 无 mcp；README 复制安装 | cli 零 diff；无 mcp 文件 | pass |
| QA-010 | design S4 / D2 | supporting | codex 过 lint + README 核实日期 | command + diff | lint:adapters；读 `adapters/codex/README.md` | lint 绿；核实日期 2026-07-28 | pass |
| QA-011 | review REV-005 | supporting | 意图型提示（不枚举命令链） | manual | 读 pi `session.jsonl` user message | 仍枚举完整命令链；机械 D5 仍绿 | residual-risk |
| QA-012 | review REV-006 / residual | supporting | Cursor 原生聊天 vs 约定 raw | manual | raw format + 全事件同 ts + `_raw_capture` 交叉 | 机械等价成立；叙事弱于 Pi | residual-risk |
| QA-013 | review REV-004 | non-functional | command-map.md/.mjs 双源 | diff | 存在双文件、无双向 lint | 非阻塞裂缝 | residual-risk |
| QA-014 | evidence pack residual=none | supporting | pack 未写 Cursor 真实性差距 | manual | 对照 ARCHIVE / review | pack §5 仍 none；QA 已记录 | residual-risk |
| QA-015 | cleanliness | supporting | Skill TODO/内部细节/调试输出 | grep + lint | adapters 无 TODO/FIXME；lint 无 debug | 清洁 | pass |

## 3. Command Results

- `npm run lint:adapters` → exit 0：`lint:adapters ok`
- `npx biome check .` → exit 0：Checked 89 files；26 warnings（主要为既有 `packages/runner`/`cli` non-null；本 feature 增量 `scripts/extract-pi-session.mjs:108` useOptionalChain）
- `node scripts/validate-adapter-artifact.ts` → exit 0：pi + cursor 各 task/events/result validate ok；prompt presence + verification shape ok
- `node scripts/check-delegation-live.ts` → exit 0：
  - pi：`authentic=session.jsonl` → `source=pi-jsonl→extract-pi-session` pass（commands=5）；extracted md 再检 pass
  - cursor：`authentic=session.raw.json` → `source=cursor-raw-json` pass（commands=5）；export md 再检 pass
- `npm run check:delegation -- evidence/host-adapter-skills/pi/session.jsonl …/pi/run-dir` → exit 0
- `npm run check:delegation -- evidence/host-adapter-skills/cursor/session.raw.json …/cursor/run-dir` → exit 0
- `node --test test/adapters/check-delegated-run.test.ts` → exit 0：5/5 pass
- 毒化 OOS：`rolekit workitem list --json` 注入 pi jsonl → check:delegation exit 1（outside Available）
- skill sha256：当前 `adapters/{pi,cursor,codex}/SKILL.md` 与两宿主 `skill-version.json` 完全一致（pi `906a148f…` / cursor `d2aaf212…` / codex `863eba78…`）；git_rev=`ab6be6fe08e1cc5a7f19db929baba5409ce46123`
- `npm test`（全量）：首次 134 pass / 1 fail（`test/e2e/run-cli.test.ts` mock start→completed 竞态）；独立重跑该文件 6/6 pass。`packages/**` 本 feature 零 diff → 归因环境竞态，不阻塞本 feature DoD
- 未运行：真实 Cursor 原生 chat transcript 导出（环境无该格式产物）；不阻塞机械 D5（有约定 raw + capture 交叉核验）

## 4. Scenario Results

- [x] QA-001 Pi 委派 run：pass
  - Evidence: `run-20260728-095152-9f89`；`session.jsonl` 24 行、toolCall 指纹、时间戳递进（21 unique）、skill 名命中；extract 5 条 Available 命令；validate-adapter-artifact ok；skill-version 对齐
  - Notes: 真实 `pi -p --skill` 路径（ARCHIVE / POINTER）；user 提示枚举命令链见 QA-011
- [x] QA-002 Cursor 委派 run：pass
  - Evidence: `run-20260728-100244-8cb3`；`session.raw.json` format=`cursor-agent-session-export/v1`；`skill_load` + 5 命令；`_raw_capture/{compile,start,status,collect,verify}` stdout/exit 与 events 逐条匹配；validate ok；skill-version 对齐
  - Notes: 全事件同一 ts；叙事强度弱于 Pi（QA-012）
- [x] QA-003 四断言：pass
  - Evidence: lint:adapters ok；行数 pi 53 / cursor 52 / codex 52
- [x] QA-004 fixture 可证伪：pass
  - Evidence: positive / negative-oos / negative-noskill / pi-positive.jsonl / extract omit template
- [x] QA-005 升级路径：pass
  - Evidence: OOS 毒化 exit 1；现场委派链五命令均 exit 0，无 error 后改契约
- [x] QA-006..010 / QA-015：pass（见 Command Results）
- [ ] QA-011 意图型提示：residual-risk（非 blocking；见 §5）
- [ ] QA-012..014：residual-risk（非 blocking；见 §5）

## 5. Findings

### failed

none

### blocked

none

### residual-risk

- REV-005 / QA-011：Pi 委派 user 提示仍枚举完整 `compile→start→status→collect→verify` 命令链；extract 已忽略 user 列表，机械 D5 通过，但「仅靠 Skill description 触发」证据偏弱。Acceptance 可接受局限或补一次意图型提示抽检。
- REV-006 / QA-012 / QA-014：Cursor `session.raw.json` 为约定结构化导出（非原生 chat transcript），全事件同时间戳；已用 `_raw_capture` 交叉核验满足机械等价。evidence pack §5 仍写 `Residual Risks: none`——Acceptance 应补写真实性差距，勿被「全绿」误导。
- REV-004 / QA-013：`command-map.md` 与 `command-map.mjs` 双源，无双向一致性断言；D4 主路径仍有手滑裂缝，不阻塞本轮 QA。
- 全量 `npm test` 偶发 e2e 竞态（`run-cli` mock completed）：与 adapters 无 diff 归因；本轮 adapter 单测与隔离 e2e 均绿。

## 6. Cleanliness

- Debug output: pass（lint / check 脚本无调试噪声）
- Temporary TODO/FIXME/XXX: pass（`adapters/` 零命中）
- Commented-out code: pass
- Unused imports / dead code from this feature: pass（未改生产包表面）
- Out-of-scope files: pass（cli 零 diff；无 MCP；无 symlink 安装器；Skill 仅指导读五件产物名 + CLI 查询）

## 7. Verdict

- Status: passed
- Blocking count: 0
- Core DoD CMD-001..004：本轮独立重跑全部 exit 0
- Authentic evidence：Pi `session.jsonl` 强；Cursor 约定 raw + `_raw_capture` 机械等价通过
- Open residual（非阻塞）：REV-004 / REV-005 / REV-006（及 evidence pack residual 未同步）
- Next: `cs-feat` acceptance 阶段
- Path: `.codestable/features/2026-07-24-host-adapter-skills/host-adapter-skills-qa.md`
