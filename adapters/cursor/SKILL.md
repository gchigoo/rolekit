---
name: rolekit-adapter-cursor
description: >-
  Drive the RoleKit CLI for task compile and run lifecycle. Use when the user
  asks to compile a RoleKit task, start/status/collect/verify a RoleKit run,
  validate a RoleKit artifact, or operate the RoleKit CLI binary on PATH.
---

# RoleKit adapter (Cursor)

## When to use

Use this skill when the user wants RoleKit CLI work: compile a task YAML,
start or inspect a run, collect results, verify a run, or validate an artifact.
Call only the commands in the map below. Keep decisions with the user when the CLI fails.

## Command map

Teach these commands. Prefer `--json` so stdout is machine-readable.

| Intent | Command |
| --- | --- |
| Validate an artifact file | `rolekit validate <file> --json` |
| Create a task contract from YAML | `rolekit task create <yaml> --json` |
| Compile a task contract from YAML | `rolekit task compile <yaml> --json` |
| Start a run (foreground) | `rolekit run start <task> --json` |
| Start a run (background) | `rolekit run start <task> --detach --json` |
| Start a run with retry | `rolekit run start <task> --retry --json` |
| Query run status | `rolekit run status <run-id> --json` |
| Steer a running Pi run | `rolekit run steer <run-id> --message <text> --json` |
| Steer with durable request id | `rolekit run steer <run-id> --message <text> --request-id <id> --json` |
| Cancel a run | `rolekit run cancel <run-id> --json` |
| Collect run result | `rolekit run collect <run-id> --json` |
| Re-run verification | `rolekit verify <run-id> --json` |
| List pending gates | `rolekit gate list <id> --json` |
| Approve pending gates | `rolekit gate approve <id> --reason <text> --json` |
| Reject pending gates | `rolekit gate reject <id> --reason <text> --json` |
| Create a work item | `rolekit workitem create --kind <kind> --title <title> --json` |
| List work items | `rolekit workitem list --json` |
| Get next ready work item | `rolekit workitem next --json` |
| Attach design artifact | `rolekit workitem design <id> --json` |
| Start a work item | `rolekit workitem start <id> --task <file> --json` |
| Mark a work item done | `rolekit workitem done <id> --json` |
| Drop a work item | `rolekit workitem drop <id> --json` |
| Resume a work item | `rolekit workitem resume <id> --to <status> --json` |
| Create knowledge entry | `rolekit knowledge create --type <type> --title <title> --body-file <path> --json` |
| Get knowledge entry | `rolekit knowledge get <id> --json` |
| Search knowledge | `rolekit knowledge search --json` |
| Edit knowledge entry | `rolekit knowledge edit <id> --json` |
| Set knowledge status | `rolekit knowledge set-status <id> --status <status> --json` |
| Migrate from CodeStable/Superpowers | `rolekit migrate --from <codestable\|superpowers> --json` |

Allowed flags (D11 whitelist): `--json` on any Available command; `run start`: `--detach` `--retry`; `run steer`: `--message` `--request-id`; `gate approve|reject`: `--reason`; `workitem create`: `--kind` `--title` `--depends-on`; `workitem list`: `--status` `--kind`; `workitem start`: `--task` `--estimated-files` `--cross-module` `--migration` `--context-loaded` `--lane`; `workitem resume`: `--to`; `knowledge create`: `--type` `--title` `--body-file` `--tag` `--status`; `knowledge search`: `--type` `--status` `--tag`; `knowledge edit`: `--title` `--tag` `--clear-tags` `--body-file`; `knowledge set-status`: `--status`; `migrate`: `--from` `--source` `--target` `--decisions` `--report-dir` `--audit-only`.

## Artifact locations

After a run, read only these files under `.rolekit/runs/<run-id>/`:

- `task.json`
- `prompt.md`
- `events.jsonl`
- `result.json`
- `verification.json`

Use CLI queries (`run status`, `run collect`, `verify`) for other run information. Do not browse other files under `.rolekit/`.

## When CLI fails

If a rolekit command exits non-zero, report the CLI output and exit code to the
user unchanged. Do not edit the task contract. Do not invent a substitute plan.
Allowed follow-up rolekit commands after a failure: `rolekit run status <run-id> --json`
and `rolekit run collect <run-id> --json` only.
