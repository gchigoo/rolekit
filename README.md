# RoleKit

RoleKit provides portable role and task contracts for invoking coding agents across hosts. It
does not own the agent loop or project workflow.

The package has one small host-independent core and separate CLI adapters for Pi, Cursor, and
Codex. Applications explicitly register roles and adapters, select one executor for each run,
and receive a normalized `RunResult`.

## Design

- **Portable contracts**: `RoleSpec`, `TaskPacket`, `ExecutorDescriptor`, and `RunResult`.
- **Explicit routing**: every run names one executor; core performs no fallback.
- **Capability admission**: an adapter is never invoked when it lacks a required capability.
- **Typed output**: role input and output are checked against JSON Schema at runtime.
- **Provenance**: normalized artifacts record the run and actual executor that produced them.
- **Independent adapters**: Pi, Cursor, Codex, and third-party adapters live outside core.

RoleKit deliberately has no work-item lifecycle, gate engine, retry policy, persistence layer,
worktree manager, migration framework, evaluation campaign, or project-completion decision.

## Requirements

- Node.js 22.18 or newer
- One supported coding-agent CLI, or an application-provided adapter

## Install from this repository

```bash
npm install
npm run check
```

The package remains private until licensing and publication are explicitly approved.

## Contracts

```ts
import { Type, type Static } from '@sinclair/typebox'
import {
  Rolekit,
  type RoleSpec,
  type TaskPacket,
} from '@gchigoo/rolekit/core'
import { CursorCliAdapter } from '@gchigoo/rolekit/cursor'

const InputSchema = Type.Object({
  request: Type.String({ minLength: 1 }),
})
const OutputSchema = Type.Object({
  changedFiles: Type.Array(Type.String()),
})

type Input = Static<typeof InputSchema>
type Output = Static<typeof OutputSchema>

const role: RoleSpec<Input, Output> = {
  schema: 'rolekit/role-spec@1',
  id: 'implementer',
  description: 'Implement one bounded repository change.',
  requiredCapabilities: ['repository.read', 'repository.write', 'shell'],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
}

const task: TaskPacket<Input> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'change-health-endpoint',
  roleId: role.id,
  objective: 'Add a typed health endpoint.',
  input: { request: 'Add GET /health.' },
  context: [],
  constraints: ['Do not add production dependencies.'],
  acceptanceCriteria: ['Relevant tests pass.'],
  allowedPaths: ['src/**', 'test/**'],
  expectedArtifacts: [{ name: 'implementation-summary', kind: 'text' }],
}

const rolekit = new Rolekit({
  roles: [role],
  adapters: [new CursorCliAdapter()],
})

const result = await rolekit.run<Input, Output>(task, {
  executorId: 'cursor',
  cwd: process.cwd(),
  adapterOptions: {
    model: 'auto',
    timeoutMs: 600_000,
  },
})
```

Core recognizes only these portable capabilities:

- `repository.read`
- `repository.write`
- `shell`
- `web`
- `vision`

Run statuses are terminal and intentionally small: `completed`, `failed`, `blocked`, and
`cancelled`.

## CLI

```text
rolekit validate role examples/roles/implementer.yaml
rolekit validate task examples/tasks/implement-feature.yaml
rolekit run \
  --role examples/roles/implementer.yaml \
  --task examples/tasks/implement-feature.yaml \
  --executor cursor \
  --options examples/options/cursor.json \
  --json
```

The Cursor adapter invokes `cursor-agent` in headless CLI mode. Read-only tasks use plan mode;
tasks requiring writes or shell execution use forced non-interactive mode. Prompts are delivered
through standard input and stream JSON is parsed into the normalized result.

Pi and Codex are also CLI adapters. The application can override the command, environment,
model, timeout, and declared capabilities through opaque adapter options.

## Add another executor

Implement `ExecutorAdapter`, then register it:

```ts
const rolekit = new Rolekit({
  roles: [role],
  adapters: [
    new CursorCliAdapter(),
    myAdapter,
  ],
})
```

Adding an adapter requires no core switch statement and does not change the contracts.

## Architecture and integration

- [Architecture](docs/architecture.md)
- [Veritack integration boundary](docs/veritack.md)
- [Chinese README](README.zh-CN.md)
