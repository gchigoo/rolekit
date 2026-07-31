# items.yaml writeback notes (driver owns the write)

Feature: host-adapter-skills
Suggested status: done (after acceptance)

Evidence for Goal Coverage Matrix row "2 hosts each >=1 delegated run via thin Skill":

- Pi: `evidence/host-adapter-skills/pi/` (session.md, session.jsonl, run-dir/, skill-version.json, check pass via `node scripts/check-delegation-live.ts`)
- Cursor: `evidence/host-adapter-skills/cursor/` (session.md, run-dir/, skill-version.json)

Commands green at archive time:

- `npm run lint:adapters`
- `npm run check:delegation -- <session> <run-dir>` (both hosts)
- `node scripts/validate-adapter-artifact.ts`
- `node scripts/check-delegation-live.ts`

Codex: delivered under `adapters/codex/` with README verification date 2026-07-28; not acceptance-blocking.

Do not include remotes, push, or credentials in roadmap notes.
