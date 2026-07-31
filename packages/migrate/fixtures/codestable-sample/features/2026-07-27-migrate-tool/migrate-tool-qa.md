---
doc_type: feature-qa
feature: 2026-07-27-migrate-tool
status: passed
reviewed: 2026-07-29
---

# migrate-tool QA 报告

## 结论

**PASS**。两源主验收（CodeStable self audit/apply、Superpowers 5.1.3 apply+no-op）、关键负例与门禁命令通过。

## 命令证据

| ID | 命令 | 结果 |
|---|---|---|
| CMD-001 | `npm test`（migrate 相关 15 测 + 全仓；knowledge-cli 偶发 supervisor timeout 重跑绿） | pass |
| CMD-002 | `npx tsc --noEmit` | pass |
| CMD-003 | `npx biome check .` | pass（warnings only） |
| CMD-004 | `node --test test/e2e/migrate.test.ts` | pass |
| CMD-005 | `npm run validate:migrations`（对 fresh apply target） | pass（脚本已接线；e2e apply 后产物经 validateArtifact） |

## 场景核对

- CodeStable audit：mandatory 九行；discovered feature=11/roadmap=1/roadmap-item=11/adr=6/compound=3/attention-rule=1；10×`.gitkeep` 仅 discarded
- CodeStable apply → fresh target `.rolekit` 出现；WorkItem/Knowledge validate
- Superpowers 14→8+6 apply；二次 apply no-op；usage 缺 `--source` → exit2
- D5 状态表 + unknown/missing；duplicate skip 不误伤保留 target；assignIds>999 失败
- 源只读：fixture/自仓 `.codestable` 未改写（compound 前置补齐 title/created/doc_type 属源数据可迁移性修复，非 migrate 运行时写源）

## 残留风险

- 负例深度（symlink/超限/rename 故障矩阵、multibind golden、profile raw-sha 锁）未全覆盖 → review REV-002 important
- compound 冻结点曾为 0，现源有 3 条 learning → 验收以当前源为准
