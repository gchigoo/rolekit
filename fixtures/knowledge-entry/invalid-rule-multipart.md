---
schema: rolekit/knowledge-entry@1
id: KN-20260728-003
type: rule
title: No debug console.log in committed code
status: active
tags:
  - cleanliness
created: "2026-07-28T00:00:00.000Z"
source: null
---

Never leave console.log debug statements in committed RoleKit packages.

CLI user-facing output must go through the dedicated output path instead.
