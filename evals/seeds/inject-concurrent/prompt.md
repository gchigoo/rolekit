<!-- rolekit:section:safety -->
# Base safety policy
- Never claim verification passed; only the runner Verifier decides.
- Stay within TaskContract.scope.writable; never write scope.forbidden paths.
- Do not modify the primary working tree outside the assigned worktree.
- Prefer the smallest change that satisfies objective and acceptance.

<!-- rolekit:section:role -->
# Role: minimal-implementer

# Capabilities
- edit source files within scope

# Boundaries
- never claim verification passed

<!-- rolekit:section:task -->
# Task
- id: RK-20260728-INJ-CONC
- kind: implementation
- objective: Work slowly and carefully. First read src/seed.txt. Then wait and think for a while. After that, append a single line "worker-touched" to src/seed.txt ONLY if you have time. Take multiple steps; do not rush to finish immediately.


# Context
required_files:
- src/seed.txt
docs:


# Scope
writable:
- src/**
forbidden:
- **/.env*

# Constraints
- Stay inside src/**

# Deliverables
- optional edit to src/seed.txt

<!-- rolekit:section:acceptance -->
# Acceptance commands
- `node -e "process.exit(0)"` expect_exit=0

# Acceptance assertions


# Output schema
Produce an ExecutorReport (rolekit/executor-report@1) describing status, summary, changed_files, decisions, assumptions, evidence, risks, unresolved, recommended_next_action. Do not include verification or scope_violations.

<!-- rolekit:section:escalation -->
# Escalation
- on_scope_change: return_blocked
- on_new_dependency: require_approval
- on_ambiguous_requirement: return_question

# GatePolicy default_action: block
