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

### D23 · The Users table pins properties; the rest reads in one Attributes column — 2026-10-24
Supersedes D4. Showing every schema property as a column made wide schemas scroll the table and pushed the row menu out of reach. By default the table shows User, Attributes, Status, Member of, ID and the row menu. Right-clicking the table (a long press on touch) opens a Columns menu that pins properties as columns, grouped by schema when the list mixes them; there is no toolbar button for it, and a right-click on a link keeps the browser's own menu; pins are per viewer, kept in the browser per project, schema and property. Every unpinned attribute reads in one fixed-width Attributes cell (`givenName: Maya · company: Acme · +3`) that opens the user's full attributes as JSON/YAML. The row menu is sticky, so it is reachable at any width, and so is the User column from 640px (on a phone the two would leave no room between them).
Identity: the identifier stays in the User cell (no Identifier column, D20), but always with its property as a chip (`email`, `username`) instead of a tooltip, since a list that mixes schemas signs people in with different properties. Hovering the user opens an identity card: schema, what they sign in with, display name, memberships, lifecycle owner and created date, with a line on what `x-identifier` and `x-display` decide. Chosen over bringing the Identifier column back, which repeats the identifier whenever a schema designates no display name.
Teams: the column is "Member of", since it lists memberships; a `pending` or `inactive` membership carries a tag. The team that owns a user's lifecycle is a different relation (ADR 024) and shows in the identity card, not the column.
→ Design review of the Columns menu, the Attributes cell and its popover, the identifier chip and the identity card.

### D22 · The sidebar lists every screen, and asks for a project when one is needed — 2026-10-23 · [standing]
As in Vercel, the sidebar lists the project's screens before a project is selected, rather than Projects alone. Opening one without a selection goes to Projects first: the page is headed "Continue to Teams" (or whichever screen), that screen's entry is the one marked in the sidebar, and choosing a project goes on to it. Arriving at the console (`/`) with nothing selected lands on Projects itself, not on the way to Users, since it asked for no screen. Amends Console ADR 0001.

### D21 · The Projects list tells many projects apart — 2026-10-23 · [standing]
Projects is where the console lands whenever several projects can be chosen, and a platform operator acts on every project of the deployment, so the one-project list of D11 no longer fits. Each row carries the project's generated mark (the project switcher's), its name with its site's host under it (D20's pattern), its ID, which takes the slack and copies, and its created date. A list that fits on one page reads by name; a longer one keeps the server's order and is found by search, which shows as soon as there is a project. New project sits beside the title (D19) and opens a drawer (D15) with the CLI's setup command, since a project is created from the app it connects. The top bar carries no project switcher on Projects: the page is that list at full size, with its own search, so the selected project is marked "Current" in it instead. Supersedes the list half of D11.

### D20 · The Users table shows each value once — 2026-10-20 · [standing]
The User cell carries the display name with the identifier under it, so there is no Identifier column, and a schema column that only repeats a row's name or identifier is dropped (under the default schema, the email). The ID column gives way first and truncates. Refines D4. The console's landing (`/`) is Users, where people who just signed up appear.

### D19 · List page actions sit beside the title — 2026-10-07 · [standing]
The primary action of a list screen (Add) stays on the title row at every breakpoint, never stretched to full width or dropped under the title. Search is out of the page headers until there is a console-wide solution.

### D18 · Console corners are 8px — 2026-10-07 · [standing]
Every console surface (cards, tables, panels, dialogs, drawers, alerts, tab strips) uses the 8px radius token. The softer shadcn defaults (10px, 14px, 18px) are not used.

### D17 · Every directory is a resource table — 2026-10-07 · [standing]
User schemas and Login flows draw the same data table as Users, Teams and Projects: a name column with the resource icon, the resource's own columns, a date, and the row menu. The stacked card rows broke on narrow widths. Supersedes D7 and the schema half of D0a. The schema id leaves the list row for the detail header card, which matches Login flows (refines D10).

### D16 · Profile is generated from the person's own schema; the identifier is read-only — 2026-09-30, amended 2026-10-16 · [standing]
Claiming asks for nothing but an email address, and the identifier cannot be changed, so the schema's `x-identifier` (the email by default) is a disabled field. Amended: Profile is generated from the person's own user schema as Add user is — every property is a row; strings and numbers are editable and saved through `PATCH /users/me`, anything a text input cannot round-trip (a boolean) is read-only. The platform project's schema adds an optional `name` designated as `x-display`, so the people operating Zitadel can name themselves; the account menu offers it while none is set.

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
