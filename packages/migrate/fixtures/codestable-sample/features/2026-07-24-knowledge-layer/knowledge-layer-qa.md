---
doc_type: feature-qa
feature: 2026-07-24-knowledge-layer
status: passed
reviewed: 2026-07-29
---

# knowledge-layer QA

## 范围

对照 design 验收场景与 checklist DoD：core catalog/compilePrompt、CLI store 五命令、runner snapshot/digest/reservation-only、四类 validate、mock rule 注入。

## 命令证据

| ID | 命令 | 结果 |
|---|---|---|
| CMD-001 | `npm test` | pass（222/222；偶发 supervisor ack timeout flaky 重跑绿） |
| CMD-002 | `npx tsc --noEmit` | pass |
| CMD-003 | `npx biome check . --diagnostic-level=error` | pass |
| CMD-004 | `node --test` knowledge catalog/store/snapshot/compile-prompt + `test/e2e/knowledge-cli.test.ts` | pass |
| CMD-005 | `rolekit validate` 四类正负 fixtures | pass（正例 exit0 / 负例 exit1） |

## 场景覆盖

- create active rule → mock run prompt + knowledge-snapshot 命中；edit 后旧 run 字节不变；deprecated 后新 run 无 rules
- 空/非 active/非 rule 不注入；四类 validate 正负
- search fail-closed；锁 stale/lock_held；同日 id 递增
- reservation-only 同 digest 续建 / 异 digest inconsistent；loader 三码零追加写
- title 改 digest 变、tags 改不变；非 `.md` sidecar 忽略

## 残余

- runner 既有偶发 `supervisor_start_failed` / ack timeout flaky（与 knowledge 路径无关，隔离重跑绿）
- NIT：CLI 非 `.md` sidecar 单测、loader `lock_held`/`knowledge_io_failed` 零写独立用例（不阻塞）

## Verdict

**passed**
