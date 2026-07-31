---
doc_type: feature-acceptance
feature: 2026-07-27-migrate-tool
status: passed
accepted: 2026-07-29
confirmation_id: rk-v2-goal-exec-20260728-a1
---

# migrate-tool 验收报告

## 结论

**accepted**。design D* 交付：`packages/migrate` + `rolekit migrate` CLI、CodeStable/Superpowers adapters、fresh-target staging+rename、RFC8785 bundle、D14 roadmap/items/command-map 补丁；独立 review round3 passed；QA passed。

## 验收对照（摘要）

1. mandatory 九行 / Superpowers 两行；self 实体记账；gitkeep 仅 discarded
2. 状态精确表；unknown/missing fail
3. bound merge + goal depends；duplicate 不物化
4. ADR/compound/attention/Superpowers note metadata 与 codec validate
5. decisions 可 skip；封闭 skip；被引用 empty/owner skip 失败
6. audit-only 外部 report；apply fresh rename；no-op 五 identity+三 digest
7. Superpowers 5.1.3/MIT/14=8+6；LICENSE 落盘
8. D14 4.5/4.8–4.10/item10/Matrix/host/items 已合入

## 授权

- goal-acceptance + goal-commits：`approval-report.md` / `rk-v2-goal-exec-20260728-a1`
- 不 push；scoped commit 排除意外 `.rolekit/` dogfood

## 后续

goal `current_feature_index` → 10（hardening-dogfood-switchover）
