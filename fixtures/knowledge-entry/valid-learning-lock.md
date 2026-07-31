---
schema: rolekit/knowledge-entry@1
id: KN-20260729-002
type: learning
title: Stale lock cleanup once
status: active
tags:
  - locking
created: "2026-07-29T00:00:00.000Z"
source: null
---

# Stale lock cleanup once

WorkItem and knowledge directory locks clear a stale pid at most once, then fail with lock_held.
