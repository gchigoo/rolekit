---
doc_type: feature-impl-note
feature: 2026-07-27-hardening-dogfood-switchover
stage: s1-admission
status: done
---

# S1 准入与 T0 元根引导记录

## 结论

S1 准入与 T0 meta-root 引导完成；尚未进入 g00/RK-01 live。SwitchDecision 未裁定。

## 证据

- migrate bound smoke：self `.codestable` → temp target；roadmap-item `hardening-dogfood-switchover` action=merge，含 `source_locator` 与非空 `target_id`，WI 文件存在
- migrate unbound smoke：最小 demo roadmap orphan-item action=migrate，`target_key=wi:roadmap-item:demo:orphan-item`，含 locator+target_id
- canonical：`dogfood/plan.yaml`（campaign_id=`rk-v2-hd-20260729`）、`dogfood/runtime/**`（bundle 29 entries）
- D12：roadmap 4.3/4.5/4.8/4.9/item11/Matrix/changelog 已合入；host Available 全量提升留给 RK-05（保持 lint:adapters 绿）
- campaignRoot：`%USERPROFILE%/.rolekit-dogfood/campaigns/rk-v2-hd-20260729`
- raw：`campaign-started.json`、`steer-nonces.json`、`bootstrap-log.jsonl`、`tasks/*.json`
- compile：十一 TaskContract（含 RK-04 recovery）+ 两项目各四 role validate + loader dry-run 全绿；self 独有 openai-responses profile

## 阻塞

- `OPENAI_API_KEY` 缺失：RK-06 冻结 `executor=openai-responses`，禁止降级
- 未做：g00 candidate、RK-01..07 live、seal/promotion、check:switch、独立 review/QA/acceptance、scoped commit
