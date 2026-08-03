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

## Execution ownership

```text
Host harness (outside RoleKit)
  -> RoleKit config/compiler
  -> ExecutionPlan
  -> host-native executor OR bundled adapter
  -> ExecutionReceipt(planDigest + actual executor + ExecutorResponse)
  -> RoleKit digest-consistency check and finalizer
  -> RunResult v2
```

The host harness owns orchestration, workspace lifecycle, retries, gates, and strong isolation.
Claude Code, Grok, Codex, and Cursor do not need host adapters merely to call RoleKit. Add an
executor adapter only when RoleKit delegates a task to that runtime. Host-native execution uses
`compile → receipt → finalize`; bundled delegation performs the same plan/receipt/finalization
semantics around the selected adapter.

## Requirements

- Node.js 22.18 or newer
- One supported coding-agent CLI, or an application-provided adapter

## Install from this repository

```bash
npm install
npm run check
```

The package is MIT-licensed and remains private until publication is explicitly approved.

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

## Stable package entry points

Code is exported from `.`, `core`, `config`, `adapter-cli`, `pi`, `pi-rpc`, `cursor`, `codex`, and
`testing`. Versioned JSON Schemas are exported under `schemas/role-spec.v1`,
`schemas/task-packet.v1`, descriptor/config/execution-plan/receipt paths, and RunResult v1/v2 paths.
The unversioned `run-result.schema.json` alias now points at the current RunResult v2 schema;
`schemas/run-result.latest` also resolves to v2.

## CLI

The config-driven CLI loads one explicit config graph and selects exactly one default or overridden
executor profile. It never scans packages or falls back to another profile.

```text
rolekit config validate --config examples/rolekit.yaml
rolekit compile \
  --config examples/rolekit.yaml \
  --role reviewer \
  --task examples/tasks/review-change.yaml \
  --executor host-reviewer \
  --json
rolekit run \
  --config examples/rolekit.yaml \
  --role implementer \
  --task examples/tasks/implement-feature.yaml \
  --json
rolekit finalize --plan resolved-plan.json --receipt execution-receipt.json --json
rolekit executors list --config examples/rolekit.yaml --json
rolekit executors describe \
  --config examples/rolekit.yaml \
  --executor pi-rpc-implementer \
  --json
```

`config validate`, `compile`, and static `executors describe` inspect configuration without reading
environment secret values or probing executables. `compile` performs task-aware static admission and
always emits an integrity-bound `ResolvedExecutionPlan`; a denied plan exits with code 4 and must not
be executed. Host profiles use `compile` plus `finalize` and are never represented by a fake adapter.
Only configured adapter `run` resolves declared environment references and probes or invokes the
selected executable. `executors describe --probe` runs credential-free version/help checks with the
static prepared options and does not authenticate.

**Security warning:** compiled plans exclude resolved credentials, but they embed complete normalized
role, task, input, context, constraints, and acceptance-criteria snapshots. Treat every plan as
potentially sensitive user data even though it is credential-free. JSON-mode `compile` output is a
CLI envelope: hosts must extract and persist only `data` as the resolved-plan document for
`finalize`, not the whole CLI envelope.

Every `--json` command writes exactly one stdout document:

```json
{"ok":true,"data":{},"warnings":[]}
```

Errors use `{"ok":false,"error":{"code":"...","message":"..."},"warnings":[]}`. CLI warnings
remain outside plans and results. Exit codes are: `0` success, `1` execution/finalization failure,
`2` usage error, `3` invalid config or contract, `4` blocked or host execution required, `130`
SIGINT, and `143` SIGTERM. Envelope shape does not change with the exit code.

The CLI accepts only the config-driven `run --config <file> --role <role-id> --task <file>` form.
The pre-config `run --role <file> --executor ... --options ...` entry point has been removed.

The Cursor adapter invokes the current official `agent` executable in headless mode. It enables
`--sandbox enabled` by default and passes `--trust` only for headless workspace trust. Read-only
tasks use plan mode. Tasks with `repository.write` use forced mode. A task that requests `shell`
without `repository.write` is blocked before probing because Cursor cannot guarantee that
permission distinction. The adapter does not discover or special-case the retired `cursor-agent`
entry point; custom commands are treated as explicit caller-supplied executables and must pass the
same probes as `agent`.

Pi is isolated by default with no sessions, context files, extension/skill/template discovery, or
inherited user agent directory. It receives a controlled system prompt and an explicit tool
allowlist derived from the admitted capabilities; Pi has no separate approval flag. Exact extension, skill, and prompt-template
paths may be declared without enabling discovery. `discoverProjectResources` is a separate,
explicit opt-in. A role that requests `shell` without `repository.write` is blocked before probing:
Pi's `bash` tool can write, so that permission distinction is not claimed without fixture-backed
write isolation. The Grok 4.5 prompt profile remains adapter-owned and uses the typed `thinking`
option when supplied.

Codex ignores user config and execpolicy rules by default and passes `project_doc_max_bytes=0` to
disable project instructions. `--ignore-rules` isolates execpolicy files, not `AGENTS.md`; project
instructions are controlled separately. Static inspection reports project instructions as
`unknown`; runtime admission upgrades them to `isolated` only after the exact typed control passes
a bounded differential parser canary. Explicit project-instruction inheritance remains
`inherited` and skips that canary. When web search is selected, the descriptor and static
admission declare `web` so required-web requests remain descriptor-consistent and can reach the
mandatory runtime probe; runtime admission retains it only after `web_search="live"` passes its
conditional typed canary, otherwise execution is blocked. Project-scoped resources and MCP
isolation remain reported as `unknown` until an enforceable disabling mechanism is fixture-backed.

There are two adapter option surfaces:

- **Built-in config profiles** intentionally expose the safe subset accepted by `rolekit.yaml`:
  shared process options are `command`, `timeoutMs`, `maxOutputBytes`, and sensitive
  `environment`; Pi/Pi RPC add provider/model/thinking, tool allowlists, exact extension/skill/
  prompt-template paths, and offline mode; Codex adds model, reasoning effort, and web search;
  Cursor adds model and sandbox mode.
- **Direct adapter APIs** expose additional unsafe opt-ins for hosts that deliberately accept that
  risk, including ambient environment inheritance, user config or agent-directory inheritance,
  project-resource discovery, Codex profiles/project-instruction/exec-policy inheritance, and
  Cursor MCP approval. Those direct-only options are rejected from built-in config profiles before
  any probe or execution.

Safe mode never copies adapter authentication or config-home values from `process.env`;
credentials must be supplied explicitly under the sensitive `environment` option. Public snapshots
replace those values with markers, while effective options record the credential source set and
explicit environment key names. Pi and Cursor use temporary isolated user homes in safe execution.
Codex also uses an isolated temporary home by default. Direct user-store opt-ins such as Pi's
`inheritUserAgentDirectory: true` and Codex's `inheritUserConfig: true` report
`credentials: 'user-store'`, while `inheritAmbientEnvironment: true` reports
`credentials: 'inherited'`. Combining a user-store opt-in with explicit credential keys is reported
conservatively as `credentials: 'unknown'`, with both source categories retained in effective public
options. Codex behavior canaries always use a separately allocated minimal environment and fresh
isolated temporary home/store that version/help never uses, with configured credentials, ambient
credential/token variables, and inherited user stores removed; credential/config/cache state written
under version/help-selected homes/stores is not available through the canary home/store paths.
Actual execution keeps its separately selected environment policy.

Unknown keys, reserved environment keys, `commandArgs`, `extraArgs`, arbitrary capability claims,
and raw config overrides are rejected before probing. Probes tokenize help output into exact option
tokens and derive the required token set from the prepared execution argument plan, including
conditional typed options. Every bundled adapter reports task `allowedPaths` as advisory rather than
claiming exact filesystem enforcement.

## Pre-1.0 adapter protocol migration

PR 3 intentionally replaces the old adapter API; there is no silent compatibility shim:

| Before | Now |
| --- | --- |
| `describe(options)` | `prepareOptions(options, publicContext?)`, then pure `inspect(prepared)` |
| availability embedded in a descriptor | `probe(prepared, { cwd, signal? })` runtime diagnostics |
| core-only capability comparison | per-run `admit(role, task, prepared, probe?)` |
| raw options passed to `execute` | prepared typed options, admission, and sensitive redaction values |

`Rolekit.run()` performs `prepare → inspect → static admit → probe → runtime admit → execute`.
`Rolekit.compile()` stops after static admission and performs no filesystem or process work.
`prepareOptions()` rejects unknown keys, freezes execution/public snapshots, and replaces literal
values in sensitive public fields with redacted markers. Adapters declare allowed marker roots with
`sensitiveOptionPointers`; core and the conformance helper reject mutable snapshots, non-object
`publicOptions`, sensitive literals in public/effective options, and markers outside those roots.
All inspect/admit/probe/execute diagnostics after preparation are redacted with the prepared
sensitive values. Requested provider/model values are configuration only; normalized executor
identity comes only from observed adapter responses and runtime probe versions.

Stored documents using the old unversioned descriptor shape remain readable through
`ExecutorDescriptorV1` and `ExecutorDescriptorV1Schema`. Active adapters must implement
`rolekit/executor-adapter@1` and return the discriminator-bearing
`rolekit/executor-descriptor@2` shape. A V1 descriptor is never reinterpreted as V2 adapter
conformance. Generated V1 and V2 schemas are published separately under `schemas/`.

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

## Publication approval gate

The package is licensed under MIT and still remains `private: true`. Publication requires an owner
to complete every step:

1. Confirm the MIT license text and package metadata are still correct for the release.
2. Run `npm run check`, `npm run test:package`, and the real CLI smoke suite.
3. Inspect `npm pack --dry-run --json`.
4. Only remove `private` and publish after explicit owner approval.

No implementation agent may remove the private gate or publish without explicit owner approval.

## Architecture and integration

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Security model](docs/security-model.md)
- [Compatibility policy](docs/compatibility.md)
- [Veritack integration boundary](docs/veritack.md)
- [Chinese README](README.zh-CN.md)
