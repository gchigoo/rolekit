# Cursor session extract (from session.raw.json)

source: Cursor session.raw.json
extractor: scripts/extract-cursor-session.mjs
Skill loaded: rolekit-adapter-cursor

## Rolekit tool invocations

Skill loaded: rolekit-adapter-cursor
Skill path: D:/Personal/rolekit/.cursor/skills/rolekit-adapter-cursor/SKILL.md

```
rolekit task compile C:\Users\steven.guo\AppData\Local\Temp\rolekit-proj-1TMHov\tasks\adapter-cursor.yaml --json
```
rolekit_exit_code: 0

```
rolekit run start C:\Users\steven.guo\AppData\Local\Temp\rolekit-proj-1TMHov\tasks\adapter-cursor.yaml --json
```
rolekit_exit_code: 0

```
rolekit run status run-20260728-100244-8cb3 --json
```
rolekit_exit_code: 0

```
rolekit run collect run-20260728-100244-8cb3 --json
```
rolekit_exit_code: 0

```
rolekit verify run-20260728-100244-8cb3 --json
```
rolekit_exit_code: 0

## Notes

Derived mechanically from session.raw.json events. No hand-sanitized command list.

## Authenticity

Canonical raw export: session.raw.json
Extract step: node scripts/extract-cursor-session.mjs session.raw.json session.export.md
