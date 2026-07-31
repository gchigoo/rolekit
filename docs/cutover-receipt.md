# Lifecycle cutover receipt

- date: 2026-07-31
- authorization: owner session confirmed cutover/push after goal acceptance (`rk-v2-goal-exec-20260728-a1`)
- procedure: freeze legacy lifecycle writes → validate migration → enable `.rolekit` host entry → drop second root

## Migration

- id: `mig-codestable-7ba3e5b9d8e54bc5df46d4e4`
- mode: apply
- status: succeeded
- no_op: false
- source_manifest_sha256: `acec45efa31cfe2c402b7f0c2d245ff865ce3e68f48f70fb8ff8703b97c48c35`
- target_manifest_sha256: `4bee1b96dc0a1da5e599278194c29061f9bc181df61f7a040494b63071bb2a48`
- report: `.rolekit/migrations/mig-codestable-7ba3e5b9d8e54bc5df46d4e4/report.json`
- receipt: `.rolekit/migrations/mig-codestable-7ba3e5b9d8e54bc5df46d4e4/receipt.json`
- counts: discovered=33 migrated=22 merged=11 skipped=0 failed=0
- validate:migrations: ok (12 work-items, 10 knowledge, 7 roles)

## Runtime overlay (rolekit-self)

- `.rolekit/rolekit.yaml`: enhanced verifier; executors pi + chatgpt-codex + openai-responses
- profiles/roles: analyst, architect, coordinator, implementer, qa, researcher, reviewer
- profiles/executors: pi, chatgpt-codex, openai-responses
- policies: from `dogfood/runtime/rolekit-self/policies`

## Lifecycle root

- sole lifecycle root: `.rolekit/`
- legacy second-root archive removed after cutover (no dual-truth rollback path)

## Host entry

- adapters/command-map remain available under `adapters/`
- Cursor skill install: `npm run install-skill:cursor` (local host enablement)
