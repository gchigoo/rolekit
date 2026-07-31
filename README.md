# RoleKit

Host-agnostic development control for coding agents: lifecycle work items, machine-readable task contracts, replaceable executors, and durable run artifacts under `.rolekit/`.

[中文](./README.zh-CN.md)

## What it does

- **Work items** — feature / issue / refactor / research / goal with a command-driven state machine
- **Task contracts** — scoped goals, constraints, deliverables, and verification (not free-form prompts)
- **Runs** — isolated execution with status, steer (Pi), cancel, collect, and verify
- **Gates** — mechanical evidence gates plus a small human-confirm whitelist
- **Knowledge** — rule / adr / learning / note entries; active rules inject into the next compile
- **Profiles** — Role + Executor YAML (Pi, ChatGPT Codex, OpenAI Responses, …)
- **Migrate** — import from CodeStable or Superpowers into a fresh `.rolekit` root

Host Skills (Pi / Cursor / Codex) stay thin: they teach CLI intents and read sealed artifacts. Recovery and gate decisions stay in RoleKit / the operator, not in the Skill.

## Requirements

- Node.js `>= 22.18`
- npm (workspace root) or a compatible package manager
- Optional executors: Pi (`>=0.80 <0.90`), Codex / Responses for research paths

## Install

```bash
git clone https://github.com/gchigoo/rolekit.git
cd rolekit
npm install
npm link ./packages/cli   # puts `rolekit` on PATH
```

Install a host Skill (optional):

```bash
npm run install-skill:cursor
npm run install-skill:pi
npm run install-skill:codex
```

## Quick start

```bash
rolekit workitem list --json
rolekit task compile path/to/task.yaml --json
rolekit run start path/to/task.yaml --json
rolekit run status <run-id> --json
rolekit run collect <run-id> --json
```

Prefer `--json` for machine-readable stdout. Full intent table: [`adapters/shared/command-map.md`](./adapters/shared/command-map.md).

## Project layout

| Path | Role |
| --- | --- |
| `packages/cli` | `rolekit` binary |
| `packages/core` | schemas, compile, knowledge catalog |
| `packages/runner` | run manager, executors, verifier |
| `packages/migrate` | legacy import into `.rolekit` |
| `packages/evals` | offline run evaluation fixtures |
| `profiles/` | canonical role / executor / fragment sources |
| `adapters/` | thin host Skills + shared command map |
| `.rolekit/` | **sole** lifecycle root (work items, knowledge, runs, migrations) |

## Operator notes

- `run steer` **accepted** means the durable control was accepted, not that the worker finished the message
- owner/executor **lost** closes the run; retry is a new attempt / new run id
- do not commit secrets, `auth.json`, or raw campaign dumps
- cutover receipt: [`docs/cutover-receipt.md`](./docs/cutover-receipt.md)

## Development

```bash
npm test
npx tsc --noEmit
npm run evals
npm run lint:adapters
npm run validate:profiles
```

## Status

RoleKit v2 goal is complete. Lifecycle truth is `.rolekit/` only.

## License

Private / unpublished package metadata (`private: true`). Clarify license before public redistribution.
