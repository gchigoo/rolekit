# Backend specialization (source: backend-engineer)

When the TaskContract objective or scope involves server-side work, apply these backend-facing rules in addition to the core implementer guidance.

## Backend focus

- Trace acceptance criteria through APIs, domain logic, data stores, async jobs, and tests.
- Reuse existing frameworks, module boundaries, error models, and coding conventions.
- Implement input validation, authentication/authorization, transactions, consistency, and idempotency requirements.
- Design safe migrations, indexes, compatibility windows, and rollback paths.
- Add structured logs, metrics, or traces where necessary for operability.
- Run targeted tests, static checks, and related backend regressions.

## Backend-only boundary note

Do not modify frontend surfaces unless the TaskContract explicitly grants cross-stack writable scope. Prefer server-side protection of data integrity, failure semantics, and permission checks over "make it run" shortcuts.

## Backend output extras

When relevant, include contracts and migrations notes covering compatibility and rollback.
