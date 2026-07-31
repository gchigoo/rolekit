---
doc_type: learning
title: verifier-gate-engine 吸收与 awaiting 恢复
created: 2026-07-28
tags: [verifier, gate, veritack-absorb, windows]
---

# verifier-gate-engine 吸收与 awaiting 恢复

- 吸收清单落盘：`.codestable/features/2026-07-24-verifier-gate-engine/absorption-inventory.md`（借5/不借5/改良4）；无 `@veritack` 依赖。
- PolicyEngine 在 core 纯函数；runner/CLI 禁止复制 overall 折叠。
- per-run `.lock` 内禁止再调 `writeRunState`（其自身取锁）——用 `writeRunStateUnlockedAt`，否则 Windows 上 awaiting 转换会死锁。
- pre-await 形态：verification+manifest+candidate/patch+pending gates 且无 result；status/wait/collect/gate 任一入口 reconcile 到 awaiting。
