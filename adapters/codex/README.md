# RoleKit adapter — Codex

## Install path (verified 2026-07-28)

Verified against OpenAI Codex Skills docs on 2026-07-28:

- Repo skills: `.agents/skills/<name>/SKILL.md` (scanned from CWD up to repo root)
- User skills: `%USERPROFILE%\.agents\skills\<name>\SKILL.md`

This install script copies to the user skills directory:

```
npm run install-skill:codex
```

Or:

```
mkdir "%USERPROFILE%\.agents\skills\rolekit-adapter-codex"
cp adapters/codex/SKILL.md "%USERPROFILE%\.agents\skills\rolekit-adapter-codex\SKILL.md"
```

Optional standing pointer: paste a one-line note into repo `AGENTS.md` that RoleKit CLI work should load `rolekit-adapter-codex`. Keep workflow rules out of that note.

Requires `rolekit` on PATH. Regenerated products come from `adapters/shared/command-map.md` via `npm run build:adapters`.

Codex is delivered here but not required for host-adapter-skills acceptance.
