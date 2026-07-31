# Operator notes: steer, recovery, and cutover

## Steer semantics
- `rolekit run steer` success (`accepted`) means the durable control was accepted, not that the worker executed the message.
- On `steer_wait_timeout`, the control stays pending; retry with the same `--request-id`.
- Do not invent recovery or gate decisions inside host Skills.

## Recovery
- Owner/executor `lost` closes the current run. Retry is a new WorkItem attempt / new run id, never blind same-run reconnect.
- Use `rolekit run status` / `rolekit run collect` to observe terminal state.

## Security and privacy
- Do not commit secrets, auth.json, absolute machine paths, or raw campaign prompt/control dumps to git.
- Scope/network claims must match verifier evidence; do not over-claim sandboxing.

## SwitchDecision vs cutover
- `SwitchDecision=go` is a report that acceptance criteria passed. It is not lifecycle cutover.
- Lifecycle truth after cutover is `.rolekit/` only.
- If `.rolekit` already has new writes, do not introduce a second lifecycle root (dual-truth). Hold and reconcile instead.

## Cutover status (this repo)
- Executed 2026-07-31 after owner authorization. Receipt: `docs/cutover-receipt.md`.
- Active lifecycle root: `.rolekit/`. Legacy archive tree was removed; do not restore a second root alongside `.rolekit`.
