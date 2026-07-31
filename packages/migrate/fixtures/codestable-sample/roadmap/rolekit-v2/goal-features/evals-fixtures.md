---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-evals-fixtures
roadmap_item: evals-fixtures
status: pending
---

# evals-fixtures Goal 执行规格

## 1. Identity And Inputs

- 顺序：6/11
- 依赖：`pi-rpc-vertical-slice`（必须 `done`）
- 性质：`non-functional`
- Design：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-design.md`
- Checklist：同目录 `evals-fixtures-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-review.md`
- QA：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-qa.md`
- Acceptance：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-evals-fixtures/evals-fixtures-dod-results.json`

## 2. Delivery And Core Path

- 交付：实现 `evaluateRun(runDir)` 单一纯判定函数、真实 seed 归档与契约完整率/越界率/Envelope 完整率 fixture，并提供 `npm run evals`。
- 核心运行路径：none（非功能性 safety-net）；替代证据为真实 run seed + deterministic positive/negative fixtures + mutation/损坏输入 + 一键 eval 命令。
- 不得为 hardening 复制第二套 evaluateRun 或用 metadata 模式绕过原始 run artifacts。

## 3. Mandatory Commands

- `npm test`
- `npm run evals`
- `npx tsc --noEmit && npx biome check .`

## 4. Feature DoD And Gates

- 依赖 done；steps/scope/dod/evidence gates passed。
- Grok 4.5 High 独立 review 核验纯函数、分母/损坏输入和真实 seed；QA 运行 evals、negative fixtures 与 deterministic rerun。
- Acceptance 核验 command output、run artifacts、fixture inventory、diff summary；非功能性替代证据必须写入 QA。
- 两授权有效后才 acceptance/scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 交付物：evals package、evaluateRun、真实 seed/fixtures、scripts/tests、roadmap patch。
- 禁止 always-green fixture、排除 failed/corrupt run 来缩分母、复制生产 evaluator、手工改 seed 结果或保留临时 run/cache。

## 6. Failure Recovery Boundary

真实 seed 不可重放、fixture 不能证明负例、evaluateRun 契约需变化或独立 reviewer 不可用时 handoff；普通测试/实现缺陷按 feature loop 修复，三轮失败即 handoff。
