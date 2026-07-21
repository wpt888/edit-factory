# Frontend agent instructions

Before changing any frontend UI, read `DESIGN_SYSTEM.md` completely and follow
it as the canonical product contract.

- Choose document or workspace composition explicitly.
- Reuse shared shells and UI primitives; do not recreate their styling in page
  files.
- Do not introduce literal surface colors or arbitrary opaque gray surfaces.
- Extend a shared component variant when a reusable visual need is missing.
- For any editor side-panel or dense form, follow DESIGN_SYSTEM.md §6
  "Inspector forms" and reuse `components/ui/inspector.tsx`; never hand-roll a
  raw `<select>` or other native form control in application UI.
- Run `npm run design:check`, lint, typecheck, and focused rendered UI
  verification before considering the work complete.

If an existing screen conflicts with `DESIGN_SYSTEM.md`, treat that as legacy
drift to remove, not as a precedent to copy.
