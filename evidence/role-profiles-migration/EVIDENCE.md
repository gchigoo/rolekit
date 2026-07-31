# role-profiles-migration evidence

## Profiles

- 7 RoleProfiles under `profiles/roles/`
- Fragments under `profiles/fragments/`
- Examples under `profiles/examples/`
- Mapping report: `profiles/MIGRATION.md`

## Commands (CMD)

| ID | Command | Result |
|---|---|---|
| CMD-001 | `npm run validate:profiles` | pass (7 roles + 3 examples) |
| CMD-002 | `npm test` | pass (138) |
| CMD-003 | `npx tsc --noEmit && npx biome check .` | pass (biome warnings only, pre-existing) |
| CMD-004 | `npm run validate:profile-runs` | pass (3 runs × 5 artifacts) |

## Live Pi runs

| Role | run_id | Evidence dir | status | verification.passed |
|---|---|---|---|---|
| implementer | run-20260728-101914-745c | `evidence/role-profiles-migration/runs/implementer-run-20260728-101914-745c` | completed | true |
| reviewer | run-20260728-101938-a9b7 | `evidence/role-profiles-migration/runs/reviewer-run-20260728-101938-a9b7` | completed | true |
| researcher | run-20260728-102037-86d2 | `evidence/role-profiles-migration/runs/researcher-run-20260728-102037-86d2` | completed | true |

Harness: `node scripts/profile-dogfood-harness.ts`
Dogfood project copy: `evidence/role-profiles-migration/project/`

## Intentionally not done (parent hard rules)

- checklist.yaml status fields not updated
- goal-state / items.yaml not rewritten
- no git commit / push
