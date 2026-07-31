# Veritack integration boundary

Veritack is an optional downstream consumer of RoleKit. It is not part of RoleKit core.

## Allowed direction

Veritack may:

- create or map data into `RoleSpec` and `TaskPacket`;
- register an executor adapter at its application composition root;
- invoke `Rolekit.run`;
- store, display, or evaluate the returned `RunResult`;
- combine multiple results in its own orchestration layer;
- decide whether its own wider workflow or project is complete.

## Forbidden direction

RoleKit must not:

- import a Veritack package or module;
- add Veritack fields to portable contracts;
- call a Veritack service;
- contain a Veritack-specific adapter branch;
- persist Veritack workflow state;
- infer Veritack project completion.

The integration point is the public RoleKit contract. If Veritack needs extra state, it stores
that state beside the `RunResult` in its own data model rather than extending core with consumer
semantics.
