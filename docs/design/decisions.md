# Design Decisions

---

## Open questions

- [ ] **Project & multi-project access** — parked on the permissions foundations (Livio, Sylvana); not needed for MVP. Once ready, the project selector removed in D6 comes back in the role-assignment UI. *(owner: eng)*
- [ ] **Admin vs. end-user permissions** — separation of instance/Zitadel-admin roles from end-user roles, tied to the same permissions work. *(owner: eng)*
- [ ] **Schema status & versions** — confirm with Vitor (Mon): backend currently has only a "latest" flag — no active/inactive status and no revisions object. Is active/inactive available? *(owner: Julia)*
- [ ] **Projects in navigation** — main nav (key-resource consistency) vs. top context dropdown only. Depends on whether the API can list multiple projects (no API design yet); may be skipped for MVP since there's only one project. *(owner: Julia / eng)*
- [ ] **"Team" naming** — overloaded (customer-portal team vs. organization/tenant); consider "organization" or "tenant" instead. Note: a Teams API is already built. *(owner: team)*
- [ ] **Project name scheme** — nature words (e.g. "River") vs. random words for generated project names. *(owner: Julia)*
- [ ] **Later** — user-list filter to distinguish end-users from admin/account users. *(future)*

---

## Decisions

### D15 · Create uses a right-side drawer — 2026-07-31 · [standing]
Adding a resource (e.g. a user) opens a drawer from the right — the shadcn/ui default interaction pattern. Fields relevant to the current context (e.g. team) are preselected.

### D14 · Schema attributes shown as a simple list — 2026-07-31
On the schema detail, list the pre-populated attributes as a flat, scannable list — not an accordion or a left-nav list (schema setup will get complex, so keep the detail page roomy rather than nesting). If a schema's attribute list gets long, reuse the user-list pattern: search bar + horizontal scroll + "Load more." Rows open the detail on click (shadcn/ui list-item standard).

### D13 · No back buttons or breadcrumbs (console-wide) — 2026-07-31 · [standing]
Vercel-style navigation: no back button and no breadcrumbs anywhere in the console — you move back up via the left-side nav. (Login-flow equivalent is D9.)

### D12 · Brand colors applied — 2026-07-31 · [standing]
Use the Zitadel brand colors — red and purple — starting with the schema screens. Verified to also work in light mode.

### D11 · Projects MVP: minimal list & detail — 2026-07-31
Projects stay a table view (key resource → table; config → schema). The list returns the single claimed project (created via CLI) — no team/user/app counts, no search, no sorting (only one project), no app groups, no "add application" action. Click a project to see Project ID, issuer URL, created date, and edit the name. No settings and no tab navigation for now. Don't label anything "owning team" — projects aren't owned by teams (a cloud concept, irrelevant for self-hosters).

### D10 · Schema list & version display — 2026-07-31
No revisions object in the backend — only a "latest" flag, schema ID, and created date. Show versions as a list sorted by created date; identify each by schema ID + timestamp to the minute (date alone isn't granular — several can be created minutes apart). Add the schema ID to the detail. Authentication methods (password, passkey only — read-only) show on the detail page, not the list, for now. Refines D7.

### D9 · Login flow: no back button — 2026-07-31
Follow Google's forward-facing pattern — no back-button UI. Browser back still works and the flow's back action still fires; teams can override via their own template (back is part of the flow definition). Avoids distraction and saves mobile space. *(Max)*

### D8 · Naming: use "schema", not "template" — 2026-07-31
Stay with "schema", always qualified (user schema, team schema…). Well-known industry term; "template" and other alternatives dropped — no community poll needed. Closes the old naming question.

### D6 · Remove the project selector — 2026-07-31
Agreed in design review. Flagged because dev work had already started.
→ Julia removes it from Figma; sync with Liam to stop the in-progress work.

### D7 · Schema list columns — 2026-07-23
Show: template name, object type, authentication methods, last modified. No user count (not computable). List stays small (~20 max), so it doesn't need a dense resource-style table (see D0a).

### D5 · User list: "Load more", no pagination — 2026-07-23
DB has no offsets, so no pagination and no total count. Use a "Load more" button and make clear it's not the full list. No filtering or sorting in MVP (too expensive; fine at community/test scale).

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

### D16 · <decision> — YYYY-MM-DD
<one line on why>
→ <next step, who>

-->
