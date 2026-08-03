# Compatibility policy

RoleKit reports compatibility from an executor's parsed version **and** successful runtime feature probes. A version number by itself is never a compatibility claim.

## Version domains

RoleKit has separate version domains:

- The npm package version describes the JavaScript distribution and public package API.
- Portable contract identifiers such as `rolekit/role-spec@1`, `rolekit/task-packet@1`, and `rolekit/run-result@2` version stored or exchanged documents. A package release can support more than one contract version.
- `rolekit/executor-adapter@1` versions the active adapter protocol. Its active inspection document is `rolekit/executor-descriptor@2`.
- `rolekit/executor-descriptor@1` remains a frozen document schema for reading and validating stored V1 descriptors. It is not an executable adapter interface and is never silently upgraded into the active protocol.
- Before RoleKit 1.0, the adapter API migrated explicitly to V2 `prepareOptions()`, `inspect()`, `probe()`, `admit()`, and `execute()` boundaries. Describe-only or V1-shaped adapters must be migrated by their owner; RoleKit does not shim them.

## Built-in compatibility matrix

The minimum versions below are the pinned versions exercised by credential-free CI for installable CLIs at the time of this policy. Cursor's official installer is not an npm dependency, so its pinned baseline is exercised by redacted protocol fixtures and the production help/version probe contract. A newer or numerically greater version is compatible only when every critical feature check also succeeds.

| Adapter | Official executable | Minimum tested version | Critical runtime checks |
| --- | --- | ---: | --- |
| Pi one-shot | `pi` | `0.73.1` | parsed version, exact JSON mode behavior, `--no-context-files`, resource-discovery disabling controls, `--tools`, `--thinking`, and every flag used by the prepared execution |
| Pi RPC | `pi` | `0.73.1` | the Pi CLI checks, exact RPC mode behavior, fresh `get_state`, request correlation, thinking setup, protocol abort, and model setup when a model is available or explicitly configured |
| Codex | `codex` | `0.146.0` | `exec --json`, `--output-schema`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `-c`, exact typed `project_doc_max_bytes=0` behavior when isolation is selected, and exact typed `web_search="live"` behavior when web is requested |
| Cursor | `agent` | `1.0.0` | `--print`, exact `--output-format stream-json` behavior, `--sandbox`, `--workspace`, and every permission-mode flag used by the prepared execution |

Value-bearing critical features are not certified by a generic flag name or by a `--help` process that might ignore preceding operands. Every negative control has its own positive, complete outcome contract; RoleKit never treats “a nonzero exit containing the sentinel somewhere” as parser evidence. Pi one-shot uses the production `--mode json` pair in a bounded, offline, no-input startup canary: the supported value must emit the documented JSON `session` protocol record with a numeric protocol version and session id. Pinned Pi 0.73.1 silently discards an unknown mode rather than emitting a typed parser error, so its guaranteed-invalid negative control is recognized only as the exact exit-0 boundary with empty stdout and stderr; any diagnostic, nonzero exit, signal, or accepted-session output is indeterminate or contradictory and fails closed. Cursor uses a differential parser canary derived from the production `--output-format stream-json` pair: the required value must be accepted, while the guaranteed-invalid value must produce exit code 2, empty stdout, and the complete CRLF-normalized pinned `invalid value ... for '--output-format <OUTPUT_FORMAT>'` diagnostic listing `text`, `json`, and `stream-json`. Codex uses bounded `exec --strict-config` differential parser canaries derived from the exact production `-c` controls: the required typed value must match the complete normalized stdout/stderr no-prompt boundary at the pinned exit code, while the guaranteed-invalid value for the same known key must match its complete pinned typed-config rejection. `runCliProcess` retains a child termination signal separately and does not synthesize an exit code, so accepted or rejected bytes emitted before a signal cannot satisfy any of these contracts. Extra output, authentication/provider diagnostics, changed wording, wrong exit codes, timeouts, cancellation, output limits, spawn or I/O failures, signals, unrelated exits, and malformed outcomes all fail closed. The project-document canary is omitted when project instructions are explicitly inherited, and the web canary is critical only when web search is requested. Static Codex inspection keeps project-instruction isolation `unknown`; when web is selected, the descriptor and static admission declare it consistently so runtime probing can proceed, and runtime admission retains it only after successful behavior evidence. Codex behavior canaries use a distinct minimal environment and freshly allocated isolated temporary home/store that is never used by version/help, so configured, ambient, or user-store credentials are absent and credential/config/cache state persisted under the version/help-selected homes/stores is not available through the canary home/store paths even when probing or actual execution uses an opted-in environment. Pi RPC certifies `--mode rpc` through its correlated live-process `get_state`, thinking, and abort protocol exercise. None of these behavior canaries submits a task or prompt, writes stdin, or calls a provider.

Each probe returns a frozen `ExecutorProbe` with normalized `executorVersion` and deterministic `featureChecks`. Common checks include `version`, `version:parsed`, and `version:minimum-tested`; adapter-specific checks record the features listed above. If version parsing, the minimum baseline, or any critical feature check fails, `available` is `false` and runtime admission blocks before `execute()`.

## No silent fallback

RoleKit never substitutes another executor, model, provider, profile, capability set, permission mode, or executable after a failed compatibility check. The Cursor adapter uses the official `agent` executable by default. The legacy `cursor-agent` command remains available only when the caller configures that exact command and produces a deprecation diagnostic; it is never discovered or selected automatically.

Custom command paths are explicit caller choices. They must pass the same production version and feature probes as the official command and do not create a second compatibility oracle.

## Requested and observed identity

Requested identity and observed identity are different facts:

- Configured provider/model values, including aliases such as `auto`, are stored as `requestedProvider` and `requestedModel`.
- `actualProvider` and `actualModel` are recorded only when the executor protocol reports them.
- RoleKit does not copy a request into an actual-identity field and does not synthesize a hidden actual identity.
- When a protocol reports no provider or model, `actualProvider` and `actualModel` remain absent.

## Additive and breaking changes

An additive change may add an optional document field, a new non-critical diagnostic, a new adapter implementation, or support for a newer executor feature without changing existing required behavior. New enum members and newly required feature checks are treated conservatively because consumers may exhaustively match existing values.

A breaking change includes removing or changing a required field, changing final response semantics, weakening redaction or cancellation guarantees, changing an existing capability or isolation claim, changing a required adapter method, or making a previously accepted compatibility report unavailable without a documented safety reason. Stored-contract breaks require a new contract identifier. Adapter-protocol breaks require a new adapter protocol version.

Before npm 1.0, public adapter API breaks require a package minor version and an explicit migration note. After npm 1.0, they require a package major version.

## Deprecation

Non-security deprecations remain documented for at least one package minor release and 90 days, whichever is longer, before removal. A deprecation warning must identify the explicit replacement and must not trigger an automatic fallback. Safety or credential-exposure defects may be disabled immediately; the release notes must explain the compatibility impact.

## CI policy

Default pull-request CI is credential-free. It runs the reusable conformance suites, redacted golden protocol fixtures, and pinned installable Pi one-shot, Pi RPC, and Codex probes through production adapters. No authenticated execution is required.

The scheduled latest-compatibility job is optional and does not run on ordinary pull requests. It runs supported public Pi and Codex install/probe diagnostics without credentials; Pi RPC is exercised through the same Pi installation. When no runnable smoke credential/selector pairing exists, install/probe failures remain visible but are nonfatal and a clear warning is written to the GitHub step summary. Once any smoke is truthfully configured, relevant install, probe, and smoke failures remain fatal for that optional job. Pi smoke supports only explicit provider-to-credential mappings: `anthropic`/`ANTHROPIC_API_KEY`, `openai`/`OPENAI_API_KEY`, `openrouter`/`OPENROUTER_API_KEY`, `xai`/`XAI_API_KEY`, `google`/`GEMINI_API_KEY`, and `amazon-bedrock`/the `AWS_ACCESS_KEY_ID` plus `AWS_SECRET_ACCESS_KEY` pair (with optional `AWS_SESSION_TOKEN`). Unsupported or mismatched selections warn and do not count as configured, and each smoke process receives only the selected provider's credentials. Cursor is not marked configured because this repository has neither a supported unattended installer nor an owner-managed runner for the official `agent` executable; CI records that limitation explicitly instead of claiming a real-binary probe or smoke.
