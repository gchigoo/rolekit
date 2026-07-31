# Architecture

## Scope

RoleKit is a contract and invocation boundary. A host supplies a role, a task, an explicit
executor adapter, a working directory, and opaque adapter options. RoleKit returns one normalized
terminal result.

```text
Application
  | registers
  v
RoleSpec + TaskPacket + ExecutorAdapter
  | explicit executor selection
  v
RoleKit core
  | capability admission + schema validation
  v
Selected adapter
  | host-specific invocation
  v
RunResult
```

## Core

`src/core` contains:

- portable TypeScript types;
- serializable JSON Schemas;
- JSON Schema validation;
- capability comparison;
- a role and adapter registry;
- one-run normalization.

Core imports neither Node.js APIs nor adapter code. It does not inspect Git, read files, launch
processes, persist state, retry a run, choose a fallback executor, or decide whether a wider
project is complete.

## Adapter boundary

An `ExecutorAdapter` has four responsibilities:

1. report its actual availability, transport, model, version, and capabilities;
2. translate a portable role/task pair into a host invocation;
3. return a typed terminal response;
4. cancel an in-flight invocation when supported.

The bundled adapters use child processes and keep their host details outside core:

| Adapter | Command | Protocol |
| --- | --- | --- |
| Pi | `pi --mode json --print --no-session` | JSON events |
| Cursor | `cursor-agent -p --output-format stream-json` | stream JSON |
| Codex | `codex exec --json --ephemeral` | JSONL plus structured final output |

CLI prompts use standard input. On Windows, executable resolution prefers PowerShell wrappers
before command wrappers so invocation remains shell-independent and does not interpolate the
prompt into a command string.

## Execution sequence

1. Validate `TaskPacket`.
2. Resolve its registered `RoleSpec`.
3. Validate task input against the role input schema.
4. Resolve the explicitly named adapter.
5. Read and validate `ExecutorDescriptor`.
6. Compare role/task requirements with descriptor capabilities.
7. Invoke the adapter only when admission succeeds.
8. Validate the adapter response and role output.
9. Verify expected artifacts by exact name and kind.
10. Add executor identity, usage duration, and artifact provenance.

Contract/configuration defects throw `RolekitError`. Runtime inability returns a terminal
`RunResult`, normally `blocked`, `failed`, or `cancelled`.

## Dependency direction

```text
core <- adapters
core <- testing utilities
core + adapters <- CLI
RoleKit public contracts <- optional consumers
```

The direction never reverses. Optional consumers must not be imported by core or adapters.
