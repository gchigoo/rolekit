# Configuration

RoleKit configuration binds portable role specifications to explicit executor profiles. A role file describes reusable instructions, schemas, and required capabilities; provider, model, credentials, tool policy, and host transport belong in executor profiles instead of the `RoleSpec`.

## Supported flow

```text
Host harness
  -> RoleKit config loader/compiler
  -> ExecutionPlan
  -> host-native executor OR bundled adapter
  -> ExecutionReceipt(planDigest + actual executor + ExecutorResponse)
  -> RoleKit digest-consistency check and finalizer
  -> RunResult v2
```

The host harness owns orchestration outside RoleKit. Claude Code, Grok, Codex, and Cursor do not need host adapters merely to call RoleKit. Add an executor adapter only when RoleKit itself delegates a task to that runtime.

`rolekit config validate`, `rolekit compile`, and static `rolekit executors describe` do not resolve environment secrets, probe executables, or invoke agents. `compile` normalizes the selected role, task, and one executor profile; performs static admission; and emits a canonical, credential-free execution plan. Identical normalized semantic content has a stable `contentDigest`, while generated run IDs and timestamps make `planDigest` instance-specific unless the caller supplies those instance values.

## Role bindings and executor profiles

`examples/rolekit.yaml` binds `implementer` and `reviewer` to different Pi RPC models and tool policies without changing either portable role specification:

```yaml
roles:
  implementer:
    spec: roles/implementer.yaml
    executor: pi-rpc-implementer
  reviewer:
    spec: roles/reviewer.yaml
    executor: pi-rpc-reviewer

executors:
  pi-rpc-implementer:
    mode: adapter
    adapter: pi-rpc
    options:
      provider: xai
      model: grok-code-fast-1
      tools: [read, grep, find, ls, edit, write, bash]

  pi-rpc-reviewer:
    mode: adapter
    adapter: pi-rpc
    options:
      provider: xai
      model: grok-4-1-fast-reasoning
      tools: [read, grep, find, ls]
```

The example reviewer profile intentionally keeps only read/search/list tools, while the implementer
profile includes edit/write/bash tools and should only be bound to roles that require
`repository.write` or `shell`. These tool policies feed adapter admission; they are not OS or
workspace sandbox proof. Strong filesystem, process, network, and credential isolation remains the
host's responsibility.

Selection is exact. A role uses its configured profile unless the caller explicitly names another profile. An unavailable profile blocks; RoleKit never falls back to another profile, adapter, provider, model, or executable. A `mode: host` profile cannot be passed to `run`.

## Adapter mode

Use `mode: adapter` when RoleKit should prepare, probe, admit, invoke, cancel, parse, and normalize a bundled or registered adapter. Typed options are adapter-specific. Unknown options, arbitrary raw command arguments/config overrides, reserved environment variables, and unsupported capability claims are rejected.

Only adapter execution resolves declared secret references and performs executable probes. For example:

```yaml
options:
  environment:
    XAI_API_KEY:
      $env: XAI_API_KEY
```

The plan records the required secret name and public replacement markers, never the resolved value. Child environments are minimal by default.

Built-in config profiles intentionally expose a safe subset of each adapter's direct TypeScript options. `rolekit.yaml` accepts shared `command`, `timeoutMs`, `maxOutputBytes`, and sensitive `environment`; Pi/Pi RPC add provider/model/thinking, tool allowlists, exact resource paths, and offline mode; Codex adds model, reasoning effort, and web search; Cursor adds model and sandbox mode. Direct-adapter unsafe opt-ins such as `inheritAmbientEnvironment`, Pi user-directory or project-resource discovery, Codex user-config/project-instruction/exec-policy inheritance, Codex profiles, and Cursor MCP approval are rejected from built-in config profiles before probing or execution. Hosts that need those controls must instantiate the adapter directly and own the extra risk explicitly.

## Host mode

Use `mode: host` when the surrounding host executes the plan natively:

```yaml
host-reviewer:
  mode: host
  executorId: verified-review-host
  transport: in-process
  capabilities: [repository.read]
  pathEnforcement: host
  contextIsolation:
    userConfig: isolated
    projectInstructions: isolated
    projectResources: isolated
    environment: minimal
    credentials: explicit
```

The host calls `compile`, refuses denied plans, executes the exact embedded contract, and emits an `ExecutionReceipt` bound to `planDigest`. The receipt contains the actual executor information the host observed plus one `ExecutorResponse`. `rolekit finalize` recomputes and checks plan/content/contract/digest consistency and returns the same RunResult v2 semantics used by bundled adapters. Finalization performs no executable probe, secret resolution, or agent invocation.

Host capabilities, isolation, and receipts are unsigned host attestations, not sandbox proof or signatures. Unknown dimensions must be declared `unknown`. Host-level container, worktree, VM, filesystem, environment, credential, and network isolation remains the host's responsibility.

## Plans and persistence

Plans exclude resolved credentials but contain complete normalized role, task, input, context, constraints, and acceptance-criteria snapshots. Treat them as potentially sensitive. Do not put credentials in task input or context. With `--json`, extract and persist only the successful envelope's `data` value for later finalization.

Changing a role prompt fragment changes the normalized role snapshot and therefore the role and content digests. Requested provider/model fields record configuration intent; actual provider/model fields remain absent unless the executor protocol or host receipt reports them.

## Commands

```text
rolekit config validate --config examples/rolekit.yaml
rolekit compile --config examples/rolekit.yaml --role reviewer --task examples/tasks/review-change.yaml --executor host-reviewer --json
rolekit run --config examples/rolekit.yaml --role implementer --task examples/tasks/implement-feature.yaml --json
rolekit finalize --plan resolved-plan.json --receipt execution-receipt.json --json
rolekit executors list --config examples/rolekit.yaml --json
rolekit executors describe --config examples/rolekit.yaml --executor pi-rpc-implementer --probe --json
```

See [Security model](security-model.md) for capability, isolation, digest, receipt, credential, and redaction limits.
