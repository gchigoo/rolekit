# S1 spike — chatgpt-codex（2026-07-29）

## 结果：passed

| 探测 | 结果 |
|---|---|
| auth.json | present（值未落盘） |
| 默认模型 | `gpt-5.6-sol`（ChatGPT Codex 目录；`gpt-5.6` 会 400） |
| max_tool_calls | 订阅端不支持，body 省略 |
| SSE | `output_item.done` 聚合；`response.completed.output` 常空 |
| live run | `run-20260729-035120-8813` |
| Envelope.status | `completed` |
| check:research | passed |

## 实证

- activity：>=1 `web_search_call`；>=1 `url_citation`（空 title → hostname 归一）
- report.md：内联 `[^n]` + 索引；UTF-16 code units
- evidence：恰 `artifacts/report.md` + `artifacts/activity.json`
- 脱敏样本：本目录 `artifacts__*` / `result.json` / `events.jsonl`（无 JWT）

## 编码基准

index 注入按 UTF-16 code units（与 Responses annotations 一致）。
