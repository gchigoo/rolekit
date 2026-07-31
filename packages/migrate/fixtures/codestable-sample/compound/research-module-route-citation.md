---
doc_type: learning
title: research-module 路线与 citation 绑定经验
created: 2026-07-28
updated: 2026-07-29
tags: [research, chatgpt-codex, openai-responses, citation, adapter]
---

# research-module 路线与 citation 绑定经验

- live 主路径：`chatgpt-codex`（`~/.codex/auth.json`）；保留 `openai-responses`（API key），互不静默降级。
- ChatGPT 账户模型 slug：`gpt-5.6-sol`（非 `gpt-5.6` / `*-codex`）；本地 `~/.codex/models_cache.json` 可对账。
- 订阅端拒绝 `max_tool_calls`；控费靠 timeout + prompt；openai-responses 仍可用 max_tool_calls。
- Codex SSE：`response.completed.output` 常空；从 `output_item.done` 聚合；勿用 `endsWith('.completed')`。
- citation：空 title 归一为 hostname；index UTF-16；四断言不弱化。
- D6：kind=research completed evidence 恰两项（runner 不附加 verification/result/gates）。
- 空 worktree patch：integrate no-op（git apply 拒空输入）。
- token 永不落盘 / 不进 git；禁止把 ChatGPT token 当 OPENAI_API_KEY。
