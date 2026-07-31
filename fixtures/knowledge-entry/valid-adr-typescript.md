---
schema: rolekit/knowledge-entry@1
id: KN-20260728-001
type: adr
title: Full TypeScript with TypeBox contracts
status: active
tags:
  - typescript
  - schema
created: "2026-07-24T00:00:00.000Z"
source: null
---

# Full TypeScript with TypeBox contracts

## Context

RoleKit needs a single contract source that yields runtime validation, static types, and JSON Schema export.

## Decision

Use TypeScript with TypeBox as the sole schema authority across core and CLI.

## Consequences

Erasable TypeScript on Node 22.18+ can run without a build step in development; CI still runs tsc --noEmit.

## Alternatives Considered

mjs with JSDoc was rejected for weaker ergonomics and no TypeBox dual-output path.
