# host-adapter-skills evidence archive

Date: 2026-07-28
Git rev at install/run: see each host `skill-version.json`

## Coverage

| Host | Skill | Delegated run | Authentic session | Extract | check:delegation | skill sha256 |
| --- | --- | --- | --- | --- | --- | --- |
| pi | rolekit-adapter-pi | yes (real `pi -p --skill`) | `session.jsonl` | `session.extracted.md` via `scripts/extract-pi-session.mjs` | pass on jsonl + extract | skill-version.json |
| cursor | rolekit-adapter-cursor | yes (after `install-skill:cursor`) | `session.raw.json` | `session.export.md` via `scripts/extract-cursor-session.mjs` | pass on raw + export | skill-version.json |
| codex | rolekit-adapter-codex | not required (D2) | — | — | — | included in all_skill_sha256 |

## Authenticity / extract steps

### Pi

1. Raw host export: `pi/session.jsonl` (Pi session file)
2. Extract (documented, mechanical):
   `node scripts/extract-pi-session.mjs evidence/host-adapter-skills/pi/session.jsonl evidence/host-adapter-skills/pi/session.extracted.md`
3. Checker accepts either the raw `.jsonl` (auto-extracts) or the extracted md
4. `session.md` is non-authoritative appendix; DoD fails closed if only md is green while jsonl fails

### Cursor

1. Raw structured export: `cursor/session.raw.json` (skill_load + command events with exit_code/stdout)
2. Extract:
   `node scripts/extract-cursor-session.mjs evidence/host-adapter-skills/cursor/session.raw.json evidence/host-adapter-skills/cursor/session.export.md`
3. DoD live script checks authentic raw/export, not sanitized-only `session.md`

## Artifact validation note

`rolekit validate` accepts schema-bearing files (`task.json`, `result.json`, each `events.jsonl` line as `rolekit/run-event@1`).
`prompt.md` has no registered schema (markdown presence check).
`verification.json` from the runner has no `schema` field (shape check: `passed`/`results`/`scope_violations`).

DoD scripts: `node scripts/validate-adapter-artifact.ts`, `node scripts/check-delegation-live.ts`.

## Install binding

Each host: `npm run install-skill:<host>` then immediate delegated run; `adapters/` unchanged between install and run.
