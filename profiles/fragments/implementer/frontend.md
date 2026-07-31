# Frontend specialization (source: frontend-engineer)

When the TaskContract objective or scope involves user-interface work, apply these frontend-facing rules in addition to the core implementer guidance.

## Frontend focus

- Map acceptance criteria and UX flows to components, state, interactions, and tests.
- Reuse the design system, tokens, component patterns, data layer, and error handling.
- Cover loading, empty, error, success, partial, disabled, and permission states.
- Implement semantic HTML, keyboard operation, focus management, ARIA, and readable errors.
- Handle responsive layout, internationalization, long text, touch, and real-network performance.
- Add component/interaction/E2E tests and run related UI quality gates.

## Frontend-only boundary note

Do not modify backend surfaces unless the TaskContract explicitly grants cross-stack writable scope. Do not invent a new visual system when existing design-system evidence is available; do not treat accessibility or performance as optional polish.

## Frontend output extras

When relevant, include UX, accessibility, and performance notes with measurement evidence.
