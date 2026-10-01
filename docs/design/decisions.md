# Design Decisions

---

## Open questions

- [ ] **Project & multi-project access** — parked on the permissions foundations (Livio, Sylvana); not needed for MVP. Once ready, the project selector removed in D6 comes back in the role-assignment UI. *(owner: eng)*
- [ ] **Admin vs. end-user permissions** — separation of instance/Zitadel-admin roles from end-user roles, tied to the same permissions work. *(owner: eng)*
- [ ] **Schema status & versions** — confirm with Vitor (Mon): backend currently has only a "latest" flag — no active/inactive status and no revisions object. Is active/inactive available? *(owner: Julia)*
- [ ] **Projects in navigation** — main nav (key-resource consistency) vs. top context dropdown only. Depends on whether the API can list multiple projects (no API design yet); may be skipped for MVP since there's only one project. *(owner: Julia / eng)*
- [ ] **"Team" naming** — overloaded (customer-portal team vs. organization/tenant); consider "organization" or "tenant" instead. Note: a Teams API is already built. *(owner: team)*
- [ ] **Project name scheme** — nature words (e.g. "River") vs. random words for generated project names. *(owner: Julia)*
- [ ] **Font loading for Zitadel-served login** — `font_url` property vs. a hosted font picker vs. custom CSS overrides; needs a CSP answer before it can be designed. *(owner: Max)*
- [ ] **Relative vs. absolute asset paths** — a relative logo path typed into the console resolves against the customer's app, not the console; decide what we validate and how the field explains it. *(owner: Max)*
- [ ] **Code ↔ console sync** — the CLI can publish but has no `fetch`/`pull`, so a console edit and a local `branding.json` can silently diverge. Blocks making branding editable (D16). *(owner: eng)*
- [ ] **Environments & releases** — how a branding change travels deploy → environment → production, and what that means for the branding screen. Workshop being scheduled. *(owner: Vitor)*
- [ ] **Named themes beyond light/dark** — the schema should later take e.g. a "navy" theme; not in this iteration, but the contract must not close the door. *(owner: Max)*
- [ ] **Later** — user-list filter to distinguish end-users from admin/account users. *(future)*

---

## Decisions

### D26 · Branding customization targets the login widget, not the page — 2026-09-02 · [standing]
Everything in the branding scope applies to `<zitadel-login>` — the card, its fields, buttons and type. The page around it (split screen, hero, marketing copy) belongs to the customer in the embedded model and to page templates/chrome in the Zitadel-served model. Two different products; don't mix their knobs into one settings screen.

### D25 · Ship the whole branding property set at once — 2026-09-02
Drop the idea of staging the API by customization level (the L1 / L2 / full-control tiering). The design system and palette already exist, so a "basic subset" API saves no implementation time — and every property we hold back is a future contract conflict. Ship the full object from #1046, designed for extensibility (named themes, per-element shape), and let the console expose a subset. *(Max)*
→ Max adds the follow-ups to #1046 and marks it ready to implement; Vitor reviews before the API work starts.

### D24 · Basic vs. advanced is a console grouping, not a permission or API split — 2026-09-02
Anyone allowed to edit branding may edit every property — no restricted tier. The console instead hides the secondary palette (surface, muted, border, link, success/warning/error) behind collapsibles/an advanced mode, grouped by where the colors are actually used and with a short description each. Success/warning/error get a hint that leaving the defaults means leaving the accessible path.

### D23 · Basic is a subset, not combined inputs — 2026-09-02
The basic view shows the real properties (primary color, logo per mode, body font, radius), just fewer of them. Anything hidden stays at its maintained default — no derived or bundled inputs behind a single control. A primary color on the default background has to look fine on its own.

### D22 · Theme mode decides which palette sections the console shows — 2026-09-02
`theme.mode` isn't only a preview toggle: light-only hides the dark palette, dark-only hides the light one, auto/system shows both. Today's screen always shows both, which is how customers ended up tuning dark values into the light theme and shipping black text on a dark surface.

### D21 · The console warns on contrast, it doesn't block — 2026-09-02
We own the design system and know which token lands on which surface, so the console can compute the contrast for each pair and flag the ones that fail. Show a warning next to the offending value ("you're using the light theme with a dark background") — no hard validation, no auto-correction.

### D20 · No asset uploads — logos and images are strings — 2026-09-02 · [standing]
`logo_url` and any later image property take a path or URL that the customer hosts, following Auth0. Avoids blob upload APIs, size limits, format rules and SVG script injection — and the embedded widget only ever applies the string anyway. The console therefore shows the path, not a thumbnail.

### D19 · Font family is a name; the customer loads the font — 2026-09-02
`typography.font_family` is a free-text input (not a dropdown of hosted fonts). The widget renders inside the customer's application, so the font is already loaded there and their CSP governs it — we only say which family the headings and body use. No font hosting and no `font_url` for embedded login in this iteration.

### D18 · No branding preview in the console (embedded login) — 2026-09-02
The console can't render a truthful preview: it doesn't have the customer's fonts, relative asset paths resolve against their app, and local code overrides always win. Editing loop is: change the value in the console, reload your own login route — the widget pulls the config from the API. Preview becomes a real question once Zitadel-served login exists.

### D17 · Page background stays out of branding — 2026-09-02
Repeated Auth0/login-v2 request, but in the embedded model we don't own the page background. What customers actually want to restyle is the card, which is `surface`. Background belongs to the page templates/chrome and is authored in Liquid.

### D16 · Branding ships read-only in the console — 2026-09-02
Same posture as schemas and flows (D0b): code is the source of truth, the console displays. Editable branding needs the revision/deploy lifecycle and a CLI `fetch`/`pull` — without them, editing in both places drifts and there's no answer for out-of-sync. Design the full editable screen now and ship it with the controls disabled, so it can be switched on as soon as revisions land. *(Vitor)*
→ Vitor schedules the environments & releases workshop (Fri or next week) so design knows the lifecycle.

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

### D27 · <decision> — YYYY-MM-DD
<one line on why>
→ <next step, who>

-->
