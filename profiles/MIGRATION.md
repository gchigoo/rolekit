# Role profiles migration report

Source root (read-only): `D:/Personal/pi-delivery-rolekit/extensions/delivery-team/agents/`
Target root: `profiles/` (library product; runtime consumes via `.rolekit/profiles/` copy per D6a)

## D1 naming map (non-1:1)

| Source agent | Target RoleProfile | Kind |
|---|---|---|
| supervisor.md | coordinator | convert + orchestration strip |
| product-analyst.md | analyst | convert/rename |
| solution-architect.md | architect | convert/rename |
| backend-engineer.md + frontend-engineer.md | implementer | merge (2→1) |
| qa-engineer.md | qa | convert/rename |
| adversarial-reviewer.md | reviewer | convert/rename |
| (none) | researcher | native new (7th seat) |

Count: 5 direct converts + 1 merge = 6 conversions; + 1 native researcher = 7 profiles.

## Per-profile extraction

### coordinator (source: supervisor.md)

| Source section | Target |
|---|---|
| 身份锚定 + Mission | fragments/coordinator/core.md opening |
| Responsibilities | capabilities (routing/dispatch items rewritten) |
| Non-responsibilities | boundaries (+ explicit no host orchestration) |
| Output contract | deliverables |
| Quality gates | verification |
| Inputs / Workflow / SuperClaude / Completion | fragment body |

Discarded:
- frontmatter `tools`
- Tools and permissions
- 能力装配 (`delivery-team`, `delivery-context-recon`, `delivery-readiness`, `delivery-handoff`)
- Orchestration/routing items: role assignment to product-analyst/solution-architect/engineers/QA/Reviewer; Workflow step "选 lane"/角色链; Output contract "Lane" wording rewritten to path/work-package language

### analyst (source: product-analyst.md)

| Source section | Target |
|---|---|
| 身份锚定 + Mission | fragments/analyst/core.md opening |
| Responsibilities | capabilities |
| Non-responsibilities | boundaries |
| Output contract | deliverables |
| Quality gates | verification |
| Inputs / Workflow / SuperClaude / Completion | fragment body |

Discarded: tools, Tools and permissions, 能力装配 (`delivery-context-recon`, `delivery-requirements`, `delivery-readiness`, `delivery-handoff`). No title variants.

### architect (source: solution-architect.md)

Same D3 mapping as analyst. Discarded tools / Tools and permissions / 能力装配 (`delivery-context-recon`, `delivery-architecture`, `delivery-readiness`, `delivery-handoff`). No title variants.

### implementer (sources: backend-engineer.md + frontend-engineer.md)

Fragments:
- `fragments/implementer/core.md` — shared identity/mission/workflow/tech/completion
- `fragments/implementer/backend.md` — backend specialization (source-labeled)
- `fragments/implementer/frontend.md` — frontend specialization (source-labeled)

Field merge:
- capabilities = union of backend + frontend Responsibilities
- boundaries = union of Non-responsibilities, with cross-stack clauses preserved and labeled
- deliverables / verification = union of Output contract / Quality gates themes

Discarded per source: tools, Tools and permissions, 能力装配 (`delivery-context-recon`, `delivery-readiness`, `delivery-backend`/`delivery-frontend`, `delivery-root-cause`, `delivery-handoff`).

#### Backend vs frontend conflict clause table

| Topic | Backend source | Frontend source | Resolution in implementer |
|---|---|---|---|
| Cross-stack edits | "不修改前端，除非任务明确给出跨端范围" | "不修改后端，除非跨端范围明确授权" | Both kept as labeled boundaries; TaskContract writable scope is the runtime grant |
| Unrelated refactors | forbidden | forbidden | Merged once |
| Design-system / UX inventiveness | n/a | no inventing new visual system | Frontend fragment + shared boundary |
| Data/migration safety | required | n/a | Backend fragment + shared verification |
| Accessibility/performance | n/a | must not defer | Frontend fragment + shared verification |

No true contradiction: each forbids editing the other stack unless the contract grants cross-stack scope.

### qa (source: qa-engineer.md)

D3 mapping applied. Discarded tools / Tools and permissions / 能力装配 (`delivery-quality`, `delivery-root-cause`, `delivery-handoff`, `delivery-readiness`). No title variants.

### reviewer (source: adversarial-reviewer.md)

Source title "Adversarial Code Reviewer"; sections otherwise match D3 names. Discarded tools / Tools and permissions / 能力装配 (`delivery-adversarial-review`, `delivery-context-recon`, `delivery-handoff`). Fragment adds explicit instruction to write the TaskContract deliverable path (examples use `docs/review-report.md`).

### researcher (native new)

No direct source agent. Reference materials (read-only, not counted as source roles):
1. `pi-delivery-rolekit/skills/delivery-context-recon/SKILL.md` — evidence-first recon method, read-only discipline, compress handoff, FACT/INFERENCE/UNKNOWN labeling
2. `rolekit/deepsearch讨论.md` — research workflow stages (clarify → brief → agentic research → evidence binding → structured report); baseline profile intentionally omits citation index / activity.json / retrieval-call requirements (owned by research-module)

## Cleanliness

Fragments must not contain `role_agent`, `agentScope`, or `delivery-*` skill names. Check: `npm run lint:profile-fragments`. This report may name source skills for audit.
