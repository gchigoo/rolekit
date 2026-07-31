---
doc_type: feature-design-review
feature: 2026-07-24-knowledge-layer
status: passed
review_state: passed
review_reason: ""
reviewer_id: "542f19ab-b042-4144-bee9-4242b02d0c2b"
reviewed: 2026-07-27
round: 8
---

# knowledge-layer feature design 审查报告

## 结论

PASS。design/checklist 可进入 epic 统一 owner checkpoint；实现仍受上游 done 与 D8 全量 patch 门禁约束。

## 审查摘要

- contract-schemas 九处替换覆盖 §2.1、Interface、D7.5、§2.2 校验流/CLI 流、流程约束及 checklist 三处，保留全部非 Knowledge semanticRules 与非 md 解析，不再存在 CLI/core parser 双权威。
- pi-rpc D3a/D3b/D6 与 checklist 五处补丁可粘贴：PromptRule 可选签名、空规则字节兼容、knowledge snapshot 齐套、digest、fresh/reservation-only 恢复和三类 loader 错误闭环。
- CLI 五命令、JSON/exit/错误码、全目录锁、首写 mkdir、safe-id/temp/atomic、坏 catalog fail-close 均可机械验收。
- ActiveRule→PromptRule→KnowledgeSnapshot 投影一致；LF 规范化与 RFC8785 hash 原像明确；existing run 不重读源。
- 四类正负、type/tags/status AND 检索、migrate pure seam、无 WorkItem FK/自动沉淀及 host-adapter 跟进边界完整。
- spec↔checklist、Acceptance Matrix、DoD、术语与占位符扫描通过，无 unresolved blocking/important finding。

## 只读证明

Round 8 reviewer 前后 SHA-256 清单一致；未修改项目文件。
