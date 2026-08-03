# Architecture

## Scope

RoleKit is a portable contract, configuration/compiler, adapter, and finalization boundary. It does not own the host harness, agent loop, project workflow, workspace lifecycle, fallback policy, retry loop, gate engine, worktree manager, or project-completion decision.

```text
Host harness (outside RoleKit)
  -> RoleKit config/compiler
  -> ExecutionPlan
  -> host-native executor OR bundled adapter
  -> ExecutionReceipt(planDigest + actual executor + ExecutorResponse)
  -> RoleKit digest-consistency check and finalizer
  -> RunResult v2
```

The host harness chooses one configured profile and owns all orchestration around this sequence. Claude Code, Grok, Codex, and Cursor do not need host adapters merely to call RoleKit. Add an executor adapter only when RoleKit delegates a task to that runtime.

## Portable core and configuration contracts

`src/core` contains portable TypeScript types, serializable JSON Schemas, JSON Schema validation, capability comparison, plan/receipt digest checks, a role and adapter registry, and one-run normalization. Core imports neither Node.js APIs nor adapter code.

Configuration schemas and public snapshots bind portable role contracts to an explicitly selected executor profile. Provider/model/tool/credential policy stays in the profile rather than changing a `RoleSpec`. Filesystem loading, secret resolution, process probing, and adapter invocation are runtime integration concerns; they do not become portable contract semantics.

Core does not inspect Git, read files, launch processes, persist state, retry a run, choose a fallback executor, synthesize hidden actual identity, or decide whether a wider project is complete. Capability and isolation fields record admission or attestations; they do not claim sandbox proof.

## Host-native execution

A `mode: host` profile is compiled but cannot be passed to `run`. Its host-native path is
`compile → receipt → finalize`:

1. The host calls `compile`, which performs no executable probe, secret resolution, or agent invocation.
2. RoleKit returns a canonical, credential-free plan with static admission and digest bindings.
3. The host refuses denied plans and executes the exact embedded contract natively.
4. The host emits one plan-bound `ExecutionReceipt` containing the actual executor information it observed and one `ExecutorResponse`.
5. `finalize` recomputes plan/content/contract consistency and returns RunResult v2 without I/O.

Host capabilities, context isolation, path enforcement, and receipts are unsigned host attestations. The host remains responsible for container/worktree/VM, filesystem, environment, credential, network, signing, and repository-trust controls.

## Bundled adapter execution

An `ExecutorAdapter` implements `rolekit/executor-adapter@1` and has six responsibilities:

1. synchronously validate, redact, snapshot, and freeze typed options with `prepareOptions`;
2. report pure static V2 capabilities and isolation claims with `inspect`;
3. resolve and probe the executable against the execution cwd with runtime diagnostics;
4. compute static and runtime per-run admission without overstating enforcement;
5. translate an admitted role/task pair into a host invocation and return a typed response;
6. cancel an in-flight invocation when supported.

The bundled adapters use child processes and keep host details outside core:

| Adapter | Command | Protocol | `allowedPaths` enforcement |
| --- | --- | --- | --- |
| Pi | `pi --mode json --print --no-session` | JSON events | advisory |
| Pi RPC | `pi --mode rpc` | correlated RPC events | advisory |
| Cursor | `agent -p --output-format stream-json --sandbox enabled` | stream JSON | advisory |
| Codex | `codex exec --json --ephemeral` | JSONL plus structured final output | advisory |

CLI prompts use standard input. On Windows, executable resolution prefers PowerShell wrappers before command wrappers so invocation remains shell-independent and does not interpolate the prompt into a command string. Cancellation terminates the subprocess tree through the platform-specific process implementation.

## Adapter execution sequence

1. Validate and freeze `TaskPacket` and resolve its registered `RoleSpec`.
2. Validate task input against the role input schema.
3. Resolve the explicitly named adapter and synchronously prepare typed options.
4. Purely inspect and validate `ExecutorDescriptorV2`.
5. Perform pure static per-run admission; `compile()` stops here.
6. Probe executable version/help against the requested execution cwd.
7. Perform runtime admission with probe diagnostics.
8. Invoke the adapter only when admission succeeds, using prepared options and redaction values.
9. Validate the adapter response and role output.
10. Produce one plan-bound receipt, verify expected artifacts and digest consistency, and finalize RunResult v2 with only actually observed executor identity.

Contract/configuration defects throw `RolekitError`. Runtime inability returns a terminal `RunResult`, normally `blocked`, `failed`, or `cancelled`. No unavailable profile falls back to another profile or executable.

## Dependency direction

```text
portable core <- configuration contracts
portable core <- adapters
portable core <- testing utilities
core + config + adapters <- CLI
RoleKit public contracts <- optional consumers and host harnesses
```

The direction never reverses. Optional consumers and host harnesses must not be imported by core or adapters.

See [Configuration](configuration.md) for profile binding and host/native flows, and [Security model](security-model.md) for the limits of capabilities, digests, receipts, isolation, and redaction.
