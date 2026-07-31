---
doc_type: roadmap-goal-feature
roadmap: rolekit-v2
feature: 2026-07-24-knowledge-layer
roadmap_item: knowledge-layer
status: accepted
---

# knowledge-layer Goal 执行规格

## 1. Identity And Inputs

- 顺序：9/11
- 依赖：`workitem-lifecycle-core`（必须 `done`）
- 性质：`functional`
- Design：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-design.md`
- Checklist：同目录 `knowledge-layer-checklist.yaml`
- Design review：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-design-review.md`
- Implementation review：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-review.md`
- QA：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-qa.md`
- Acceptance：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-acceptance.md`
- Evidence pack：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-evidence-pack.md`
- Evidence pack results：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-evidence-pack-results.json`
- Gate results：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-gate-results.json`
- DoD results：`.codestable/features/2026-07-24-knowledge-layer/knowledge-layer-dod-results.json`

## 2. Delivery And Core Path

- 交付：KnowledgeEntry 四类 rule/adr/learning/note 的 pure catalog parser/serializer/filter/select/validate/compile、CLI single-writer store、检索与 runner active-rule snapshot。
- 核心路径：新增 rule 在下一次 compiled prompt 生效；四类各 1 正例 + 1 负例通过真实 validate；search 按 type/tags/status 正确，零写命令保持目录字节不变。
- 不建立 WorkItem 外键，不把 I/O 放 core，不让 runner 实时读取可变 knowledge。

## 3. Mandatory Commands

- `npm test`
- `npx tsc --noEmit`
- `npx biome check .`
- `node --test test/e2e/`
- `rolekit validate <knowledge.md>`

## 4. Feature DoD And Gates

- 依赖 done；steps/scope/dod/evidence gates passed。
- Grok 4.5 High 独立 review 核验 pure core/single writer/snapshot 与 markdown canonicalization；QA 跑四类 validate、filters、prompt injection、Windows lock/zero-write。
- Acceptance 核验 fixtures、CLI JSON、prompt diff、knowledge snapshot、zero-write diff、Windows lock、roadmap patch。
- 两授权有效后才 acceptance/scoped commit。

## 5. Evidence, Deliverables And Cleanliness

- 交付物：core knowledge APIs、CLI store/search/validate、runner snapshot seam、fixtures/tests 与 D8 roadmap patch。
- 禁止第二 writer、WorkItem FK、可变 live reread、非 canonical frontmatter/body、临时 knowledge、锁残留或 scope 外 migration。

## 6. Failure Recovery Boundary

canonical bytes/locking/snapshot 无法闭合、需改变上游 schema、核心 CLI 路径不可验证或依赖未 done 时 handoff；普通 defect 按 feature loop 修复重验，三轮失败即 handoff。
