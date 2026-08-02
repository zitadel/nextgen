# Design Decisions

---

## Open questions

- [ ] **Schema vs. template naming** — keep "schema" but always qualified (user schema, team schema…)? Ask the community via poll. Predefined ones may be surfaced as "templates." *(owner: Elina)*
- [ ] **Project access** — a user maps to one project only today; multi-project and how project ↔ team ↔ access relate is unresolved. *(owner: eng)*
- [ ] **Admin vs. end-user permissions** — instance/Citadel-admin roles should be separate from end-user roles (admin assigned in settings, not the create-user pane; maybe read-only on the user page). Concept not settled. *(owner: eng)*

---

## Decisions

### D6 · Remove the project selector — 2026-07-31
Agreed in design review. Flagged because dev work had already started.
→ Julia removes it from Figma.

### D5 · User list: "Load more", no pagination — 2026-07-23
DB has no offsets, so no pagination and no total count. Use a "Load more" button and make clear it's not the full list. No filtering or sorting in MVP (too expensive; fine at community/test scale).

### D7 · Schema list columns — 2026-07-23
Show: template name, object type, authentication methods, last modified. No user count (not computable). List stays small (~20 max), so it doesn't need a dense resource-style table (see D0a).

### D4 · User table shows all columns — 2026-07-23
Show every available field for MVP rather than picking defaults. Per-user column customization comes later.

### D3 · User detail layout — 2026-07-23
Overview (teams, roles) + Authentication tab. Auth is read-only (password, passkey); auth config comes later at team level. Editing a user is inline (edit + save directly). Schema is mandatory and never selected from this page.

### D2 · Delete is a hard delete — 2026-07-23
Irreversible, no recovery. Keep the type-"delete"-to-confirm step + success toast — it's the only irreversible action, so keep it even for the community lounge.

### D1 · A user can belong to multiple teams — 2026-07-23
Use a multi-select / tag input, preselected from current context; reuse this pattern everywhere. Selecting a team also requires selecting a role within that team.

### D0c · Three default schemas — 2026-07-23 · [standing]
Minimal (email) · Consumer (email, given name, family name) · Business (+ company name).

### D0b · Schemas are read-only in the portal — 2026-07-23 · [standing]
No editing; changes go through the CLI only. Version switching is view-only (skip between versions, no restore/apply).

### D0a · Resources vs. schemas are different page patterns — 2026-07-23 · [standing]
Users/teams/projects are resources; schemas are configuration, not resources — they should look different. MVP permissions: account creator = owner; invited users get admin; evolve later.

---

<!-- New decision: copy this, bump the ID.

### D8 · <decision> — YYYY-MM-DD
<one line on why>
→ <next step, who>

-->
