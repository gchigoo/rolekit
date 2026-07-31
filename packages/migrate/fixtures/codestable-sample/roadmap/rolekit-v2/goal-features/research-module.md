---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-research-module
roadmap_item: research-module
status: pending
---

# research-module Goal 执行规格

## 1. Identity And Inputs

- 顺序：7/11
- 依赖：`role-profiles-migration`（必须 `done`）
- 性质：`mixed`
- Design：`.codestable/features/2026-07-24-research-module/research-module-design.md`
- Checklist：同目录 `research-module-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-research-module/research-module-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-research-module/research-module-review.md`
- QA：`.codestable/features/2026-07-24-research-module/research-module-qa.md`
- Acceptance：`.codestable/features/2026-07-24-research-module/research-module-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-research-module/research-module-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-research-module/research-module-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-research-module/research-module-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-research-module/research-module-dod-results.json`

## 2. Delivery And Core Path

- 交付：`chatgpt-codex` ExecutorAdapter（订阅 auth + Codex SSE）、保留 `openai-responses`、researcher/kind 特化、`report.md`/`activity.json` citation pipeline。
- 核心路径：真实 kind=research + executor=chatgpt-codex run 后 checker 四断言全过。
- 鉴权：`ROLEKIT_CHATGPT_AUTH_FILE` 或 `~/.codex/auth.json`；禁止把 token/API key 写入 manifest/log/report/git。不得降级 Pi、伪造 annotations、弱化 check:research。

## 3. Mandatory Commands

- `npm test`
- `node --test test/e2e/`
- `npx tsc --noEmit && npx biome check .`
- `npm run check:research -- <runDir>`
- `rolekit validate <artifact>`

`<runDir>` 必须是本次真实 chatgpt-codex run；checker 原始输出必须保留。

## 4. Feature DoD And Gates

- 依赖 done；改道 design approved + design-review passed；steps/scope/dod/evidence gates passed。
- Grok 4.5 High 独立 review；QA 覆盖 SSE/cancel/error、citation、真实订阅 run 与四断言。
- Acceptance 核验 command output、run artifacts、report/activity、checker output、diff summary。
- 两授权有效后才 acceptance/scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 交付物：chatgpt-codex + chatgpt-auth、保留 openai-responses、profiles、checker、unit/e2e/live、roadmap/attention/compound patch。
- 禁止 token/API key、mock-only 核心证据、Pi fallback、第二套判定公式、auth.json 入库。

## 6. Failure Recovery Boundary

缺 auth / refresh 失败 / 端点或 annotations 不可用 → NeedsHuman/handoff（D1 gate），不得降级或伪造。契约需再变、三轮同失败或 reviewer 不可用时 handoff。
