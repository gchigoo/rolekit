# Security model

## Trust boundary and non-goals

RoleKit validates portable contracts, performs capability admission, records effective policy, invokes a selected bundled adapter when requested, and normalizes one terminal result. It is not a sandbox, a workflow engine, or a security boundary around the workspace. Strong isolation remains the host's responsibility through container, worktree, virtual-machine, operating-system account, filesystem, and network boundaries appropriate to the threat model.

Capabilities are admission and grant descriptors, not proof of sandboxing. A capability says what a selected executor is admitted to do; it does not prove that the runtime, operating system, or workspace prevented other behavior. Built-in claims cannot be overridden to advertise unsupported `web` or `vision` behavior.

## Digests, receipts, and attestations

Execution-plan and receipt SHA-256 digests provide consistency binding and reproducibility. They are not signatures, do not authenticate origin, and do not protect a document when an attacker can replace both the document and its digest.

Execution receipts and host-native capabilities are unsigned host attestations. They are not cryptographic proof that a named executor ran or that the host enforced the declared policy. Signed attestations are a possible future host-layer extension; they are not part of v1. Requested provider/model identity remains distinct from actually observed identity. RoleKit does not synthesize hidden actual provider or model fields when the protocol reports none.

## Filesystem policy

Every execution plan and result records the `allowedPaths` enforcement level used for that execution:

- `advisory`: the paths are instructions and audit context only. All bundled Pi, Pi RPC, Codex, and Cursor modes currently use this level.
- `adapter`: an adapter may report this only when its implementation actually enforces the path boundary.
- `host`: a host-native profile may attest that the host enforces the path boundary.

Observing an out-of-policy write under advisory mode must not cause a result or descriptor to relabel the run as adapter- or host-enforced. Admission, capabilities, digests, and receipts do not by themselves prove filesystem containment.

## Instruction, configuration, and resource isolation

Isolation dimensions are reported independently. An unknown dimension remains `unknown`; it is never upgraded to `isolated` because another dimension is controlled.

- Pi controls the user-agent directory, project context files, project resource discovery, and exact extension/skill/prompt-template resource paths through separate channels. User/project resource channels are disabled by default unless their specific typed opt-ins or exact paths are supplied.
- Codex controls user config, AGENTS-style project instructions, and execpolicy rules independently. User config and execpolicy are ignored by default. Static inspection reports project instructions as `unknown`; runtime admission reports them as `isolated` only after a bounded typed-config differential canary accepts the exact adapter-owned project-document limit and recognizes the complete pinned invalid-value rejection for the same key. Explicit `inheritProjectInstructions: true` is reported as `inherited` and omits that isolation canary. When web is selected, the descriptor and static admission declare `web` consistently so required-web requests can reach the mandatory probe; runtime admission retains it only after the exact typed live-search control is behavior-certified and otherwise blocks execution. Broader Codex project-resource and MCP behavior remains `unknown` unless separately probe-tested and enforceably disabled.
- Cursor reports user config, project instructions, project resources, and other dimensions that the adapter cannot prove as `unknown`, not `isolated`. Cursor sandbox/trust flags do not establish an `allowedPaths` boundary.

Raw untrusted repository instructions can still influence an agent when context inheritance is enabled. Hosts must treat inherited repository instructions as untrusted input and decide whether stronger host-level isolation is required.

## Environment and credentials

Child environments are minimal by default. Ambient environment inheritance is an explicit insecure opt-in. Generic environment options cannot override adapter-controlled config-home variables or other reserved isolation controls.

Credential source is recorded separately from instruction/config isolation as `explicit`, `user-store`, `inherited`, or `unknown`. An isolated instruction channel does not imply isolated credentials, and an explicit credential does not prove instruction isolation. Pi user-agent-directory inheritance and Codex user-config inheritance may expose user credential stores; ambient inheritance may expose unrelated process credentials. Codex typed-config behavior canaries are a narrower exception: they always run in a separately constructed minimal environment with a freshly allocated isolated temporary home/store that is distinct from every home/store selected for the earlier version/help subprocesses. They receive no RoleKit-configured credentials, ambient API-key/token variables, or inherited user credential/config store; credential/config/cache state persisted under version/help-selected homes/stores is not available through the canary home/store paths. POSIX home variables and Windows `USERPROFILE`/`APPDATA`/`LOCALAPPDATA` plus `HOMEDRIVE`/`HOMEPATH` are redirected with platform-correct semantics. This does not mutate the environment used for version/help probing or actual execution.

Adapter credentials may be sourced from declared environment references. Resolved values are ephemeral and are redacted from RoleKit-owned public options, diagnostics, command evidence, errors, plans, package fixtures, and test output. Callers should pass only the credential keys required by the selected adapter/provider.

## Sensitive plans and redaction limits

Execution plans intentionally embed the full normalized role, task, input, context, constraints, and acceptance-criteria snapshots. Plans are potentially sensitive even though resolved adapter credentials are excluded. Callers must not put credentials in task input or context, and JSON CLI users must persist only the `data` plan document rather than the surrounding CLI envelope.

RoleKit cannot guarantee redaction of transformed or encoded secret values, arbitrary executor-authored output, or workspace files after the executor is granted the secret. Redaction protects RoleKit-owned evidence paths; it is not data-loss prevention for the executor or workspace.

## Host responsibilities

The host harness remains outside RoleKit. The host is responsible for environment and credential separation, workspace lifecycle, network controls, process identity, container/worktree/VM isolation, repository trust decisions, retention of sensitive plans and receipts, and any cryptographic signing or verification policy. RoleKit provides portable contracts and consistency checks without claiming those host controls occurred.
