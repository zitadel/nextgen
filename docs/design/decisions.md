# Design Decisions

---

## Open questions

- [ ] **Project & multi-project access** — parked on the permissions foundations (Livio, Sylvana); not needed for MVP. Once ready, the project selector removed in D6 comes back in the role-assignment UI. *(owner: eng)*
- [ ] **Admin vs. end-user permissions** — separation of instance/Zitadel-admin roles from end-user roles, tied to the same permissions work. *(owner: eng)*
- [ ] **Schema status & versions** — confirm with Vitor (Mon): backend currently has only a "latest" flag — no active/inactive status and no revisions object. Is active/inactive available? *(owner: Julia)*
- [x] **Projects in navigation** — main nav (key-resource consistency) vs. top context dropdown only. Depends on whether the API can list multiple projects (no API design yet); may be skipped for MVP since there's only one project. *(owner: Julia / eng)* → Resolved by D27: the account sidebar, with the top context dropdown and the logo.
- [ ] **"Team" naming** — overloaded (customer-portal team vs. organization/tenant); consider "organization" or "tenant" instead. Note: a Teams API is already built. *(owner: team)*
- [ ] **Project name scheme** — nature words (e.g. "River") vs. random words for generated project names. *(owner: Julia)*
- [ ] **Later** — user-list filter to distinguish end-users from admin/account users. *(future)*

---

## Decisions

### D30 · Search finds users and configuration, through the server's search — 2026-11-10 · [standing]
The palette found pages, teams and projects, each through a request of its own, and no user, because the Users list had no text to search by. It now asks the server's search ([ADR 087](../adrs/087-search.md)) for what the selected project holds: users by the start of their identifier or of their given or family name, teams by name, and configuration (user schemas, login flows, identity providers) by what they are called, or any of them by an id pasted into the field. Users, Teams and Configuration are groups between the project's pages and Projects. A row shows the server's title, and on the right its second line (a user's identifier beside their name), or the project where there is none. The palette stays navigation, not a results page: it lists the best five of each kind, and when there are more users a last row opens the Users list on the same text. Users are asked for from three characters and apart from the rest, so neither answer waits for the other. The Users list that the last row opens searches identifiers only, so a person found by name is not on it.
→ Actions and recent items in the palette; search across projects once the API offers it.

### D29 · Settings is one row that opens its own list — 2026-11-09 · [standing]
Amends D27, whose account sidebar listed Settings' pages (Billing, Support, Email and the profile) flat beside Projects. That list was mostly Settings, and its Settings row opened the same page as the account menu's first row. As in Vercel, the account sidebar is now Projects and one Settings row, and choosing it swaps the list for Settings' own: Profile (the person's profile, which D27 called Settings), then what the hosted cloud adds. The list is headed by its name beside a chevron, a row that leads back up to Projects. That is moving up through the left nav, as D13 asks, and not the "Back to dashboard" button D27 removed: the pill still reads "All projects" there and is still the way into a project. The account menu keeps its one row for the person, which opens Profile. Search lists Settings' pages under Account, each marked Settings, and finds them by either name.
→ Design review of the heading row and of Profile as the page's name.

### D28 · The Projects list reads newest first — 2026-11-09 · [standing]
Amends D21, which read a one-page list by name and a longer one in the server's order, by id. An id says nothing about when a project was made, so past one page a platform operator's newest project sat behind `Load more`, and the order changed the day a list outgrew its page. The list is now newest first at every length, sorted on the server by creation time, which the Created column shows; `Load more` appends older projects. By name stays the project switcher's order, where a short list is scanned for a known name, and search finds a project by name here.

### D27 · One frame for every screen; Projects heads the account sidebar — 2026-11-09 · [standing]
Supersedes D24's home without a sidebar, which made Projects a second shell and Settings a third. Every screen is drawn in one frame: the sidebar, with search at its top and the account menu in its footer, and the top bar with the project pill. Search leaves the top bar, as in Vercel, because there it sat a row above a list's own search. Above every project (Projects and Settings) the sidebar lists the account's screens instead of a project's: Projects first, then what the hosted cloud adds (Billing, Support, Email), then Settings, the person's profile. The pill reads "All projects" there and its list is the way back into a project, so Settings has no "Back to dashboard" row (D13) and Projects marks no row "Current" (D21).
Projects is a list like every other: its search beside the title (D25), and beside that a New project button (D19) opening a drawer (D15) with the CLI's `setup` command and how a project lives, which no longer sits under a list that can run to pages. With no project yet there is nothing to list, so the page is that command and that guide. The logo and the switcher's "All projects" still open Projects, and it is still where the console lands with several projects and none selected.
→ Design review of the account sidebar's order, search in the sidebar, the bar in Settings, and the New project drawer.

### D26 · User forms are built from the whole schema — 2026-11-03 · [standing]
Add user and the edit card draw one control per property of the user's schema: an object as an inline group, an array as one row per item with add and remove, an enum as a Select, a boolean as a Switch. A nullable property behaves as its type, and empty means absent. A property no control can write shows its stored value read-only and points to the CLI or API; when one is required, Add user says so and blocks. Otherwise Submit stays enabled and clicking it reveals the errors, so a form is never silently stuck. A schema's `default` prefills on create only. Free strings are sent as typed; only format-typed inputs, numbers and the identifier are trimmed. Profile stays as D16 has it.
The field `x-identifier` names carries that keyword as a badge, as on the schema screen, since a form must not leave what people sign in with to guesswork. A label is the schema's title; hovering it, or tabbing into its field, names the property in a tooltip, because the API name is reference a form rarely needs and a second line on every row would not scale. An object can be collapsed. It starts open unless it holds more than 8 properties with no required field left empty and nothing wrong, so a filled-in one can start closed. A closed one says how much of it is set and opens for any error inside it.

### D25 · The Users list filters by one revision — 2026-11-01
Amends D5, which left filtering out of the MVP. The title row carries a schema filter and a revision filter that stays in view but disabled until a schema is chosen. The revision filter picks one revision, or `Older revisions` above a separator: every user not on the newest revision, which is who is left to migrate. It is offered only when the schema has more than one revision. There is no "latest only" choice; the newest revision is picked by its id. The revision menu is shared with the schema detail's picker: each revision by its shortened id (`sch_…ZNP02S`), creation time to the minute (D10), and a filled `Latest` and an outlined `In use` badge, which a revision can carry together. The design's sort by revision is left out for now: schema ids carry no creation order (a customer's own URI `$id`, a UUID on Spanner), and the user query cannot sort by the revision's creation time without an API change. Still no total count and no sorting (D5).

### D24 · Projects is the home, drawn without the sidebar — 2026-10-26
The sidebar is one project's screens, so Projects leaves it: the logo and the project switcher's "All projects" open it, and it draws no sidebar, only a bar with the logo, search and the account menu. It is a project-free page, so the list sits in a centred column. A project is created from the app it connects, so the page hands over the CLI's `setup` command in a card beside the list instead of a New project button and drawer, and below the list it explains how a project lives: set up, build locally, deploy, add environments (each a project of its own), operate in the console. On the way to a screen (`?next=`, D22) the guide is left out. Supersedes D21's New project drawer and the sidebar row of D22.
→ Design review of the home bar, the setup card and the lifecycle guide.

### D23 · The Users table pins properties; the rest reads in one Attributes column — 2026-10-24
Supersedes D4. Showing every schema property as a column made wide schemas scroll the table and pushed the row menu out of reach. By default the table shows User, Attributes, Status, Member of, ID and the row menu. Right-clicking the table (a long press on touch) opens a Columns menu that pins properties as columns, grouped by schema when the list mixes them; there is no toolbar button for it, and a right-click on a link keeps the browser's own menu; pins are per viewer, kept in the browser per project, schema and property. Every unpinned attribute reads in one fixed-width Attributes cell (`givenName: Maya · company: Acme · +3`) that opens the user's full attributes: a Fields tab first (the schema's labels, formatted values, each object inline one level deep and anything deeper opened in place, capped at 12 rows with a link to the user), then JSON and YAML. User schemas have no server limit on size or nesting, so the popover stays a quick look rather than growing with them. The row menu is sticky, so it is reachable at any width, and so is the User column from 640px (on a phone the two would leave no room between them).
Identity: the identifier stays in the User cell (no Identifier column, D20), but always with its property as a chip (`email`, `username`) instead of a tooltip, since a list that mixes schemas signs people in with different properties. Hovering the user opens an identity card: schema, what they sign in with, display name, memberships, lifecycle owner and created date, with a line on what `x-identifier` and `x-display` decide. Chosen over bringing the Identifier column back, which repeats the identifier whenever a schema designates no display name.
Teams: the column is "Member of", since it lists memberships; a `pending` or `inactive` membership carries a tag. The team that owns a user's lifecycle is a different relation (ADR 024) and shows in the identity card, not the column.
→ Design review of the Columns menu, the Attributes cell and its popover, the identifier chip and the identity card.

### D22 · The sidebar lists every screen, and asks for a project when one is needed — 2026-10-23 · [standing]
As in Vercel, the sidebar lists the project's screens before a project is selected, rather than Projects alone. Opening one without a selection goes to Projects first: the page is headed "Continue to Teams" (or whichever screen), that screen's entry is the one marked in the sidebar, and choosing a project goes on to it. Arriving at the console (`/`) with nothing selected lands on Projects itself, not on the way to Users, since it asked for no screen. Amends Console ADR 0001.

### D21 · The Projects list tells many projects apart — 2026-10-23 · [standing]
Projects is where the console lands whenever several projects can be chosen, and a platform operator acts on every project of the deployment, so the one-project list of D11 no longer fits. Each row carries the project's generated mark (the project switcher's), its name with its site's host under it (D20's pattern), its ID, which takes the slack and copies, and its created date. A list that fits on one page reads by name; a longer one keeps the server's order and is found by search, which shows as soon as there is a project. New project sits beside the title (D19) and opens a drawer (D15) with the CLI's setup command, since a project is created from the app it connects. The top bar carries no project switcher on Projects: the page is that list at full size, with its own search, so the selected project is marked "Current" in it instead. Supersedes the list half of D11.

### D20 · The Users table shows each value once — 2026-10-20 · [standing]
The User cell carries the display name with the identifier under it, so there is no Identifier column, and a schema column that only repeats a row's name or identifier is dropped (under the default schema, the email). The ID column gives way first and truncates. Refines D4. The console's landing (`/`) is Users, where people who just signed up appear.

### D19 · List page actions sit beside the title — 2026-10-07, amended 2026-11-03 and 2026-11-10 · [standing]
The primary action of a list screen (Add) stays on the title row at every breakpoint, never stretched to full width or dropped under the title. A list's own server-side search sits with its filters beside the title: the Users list searches by the start of the identifier, because no other way exists to find a user among pages of results, and Projects by name (D27). A Users search lists its matches by identifier instead of newest first: that is the order an index returns them in, so the search stays fast in a project of any size. Filters and search take their own row under the title when they don't fit.

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
