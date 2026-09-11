# Design Decisions
---
## Open questions
- [ ] **Last-admin protection** — you can currently remove every admin, leaving the account without one. Tim says enforcing "can't delete the final role" is hard because roles are flexible; asked whether the API can block it temporarily so we don't build on a broken default. Design shows remove/revoke as if it were unrestricted until confirmed. Spec issue incoming. *(owner: eng / Tim)*
- [ ] **How invites are delivered** — three options on the table: (a) temp email service that creates the user and mails credentials + a reset-password service on first login, (b) an automation listening to the "user invited" event that triggers an invite mail, (c) show a generated password in the UI after inviting and let the inviter forward it manually. A fourth idea came up in the call: a shareable invite link (needs generation + expiry). No transactional email infrastructure exists today. Blocks the modal copy — "their sign-up link stops working" is only correct for the link option. *(owner: Sylvana / eng)*
- [ ] **Console login: dogfooding & customization** — the console uses the same login we sell as a product (Alex and Olivia want exactly that), but the login-v2-in-cloud lesson applies: a shared login you can't customize means you can't change anything without changing it globally. Needs a customization story — "sooner rather than later", and it's not API-blocked. *(owner: Liam / Max)*
- [ ] **Display names, long-term** — the given name + family name → email → user ID fallback (D30) is a stopgap. A proper solution (e.g. a schema annotation marking the identifier/display attribute — existed once, was dropped as unused; machine accounts need a configurable display name) is needed everywhere users appear: teams, sessions, activity log ("an ID is useless when you're investigating"). Deliberately parked until the raw version is out and people react. *(owner: team)*
- [ ] **Search as a global concept** — dropped from the MVP everywhere (D32); before it returns, define how search should behave console-wide (plain text filter vs. advanced criteria, inside the table vs. above it vs. the overarching search) instead of per-page one-offs. *(owner: Julia / team)*
- [ ] **Appearance placement in navigation** — currently modelled as a top-level nav item. Counter-argument (Max): branding belongs to the login journey — you define flows, then style them — so it should sit with Login flows. Possible middle ground: a main-nav group holding Flows / Authentication / Appearance. Not decided; deliberately parked. *(owner: Julia / team)*
- [ ] **Appearance: what's code-managed vs. client-side** — layout/template, logo and hero image URL look like server-side schema; colours, fonts and CSS look like client application. Needs clarifying before the read-only preview can claim to show "everything". *(owner: Julia / Vitor)*
- [ ] **Layout options per template** — "basic layout options provided by the selected design" is undefined. Need a comprehensive list of what each of the five built-in layouts includes (e.g. logo placement). No issue describes them yet. *(owner: Julia / eng)*
- [ ] **Editing branding in the console** — if config lives in code but is editable in the console, we need a sync story (a `sync` command was floated and immediately flagged as re-inventing git). Explicitly deferred: read-only first, revisit when we know whether users actually want to do it locally. *(future)*
- [ ] **Light/dark switch in the login** — the dev-only toggle is still in; open whether it stays as a user-facing switch or follows the system setting. *(owner: Julia / Liam)*
- [ ] **Project & multi-project access** — parked on the permissions foundations (Livio, Sylvana); not needed for MVP. Once ready, the project selector removed in D6 comes back in the role-assignment UI. *(owner: eng)*
- [ ] **Admin vs. end-user permissions** — separation of instance/Zitadel-admin roles from end-user roles, tied to the same permissions work. *(owner: eng)*
- [ ] **Schema status & versions** — confirm with Vitor (Mon): backend currently has only a "latest" flag — no active/inactive status and no revisions object. Is active/inactive available? *(owner: Julia)*
- [ ] **Projects in navigation** — main nav (key-resource consistency) vs. top context dropdown only. Depends on whether the API can list multiple projects (no API design yet); may be skipped for MVP since there's only one project. *(owner: Julia / eng)*
- [ ] **"Team" naming** — overloaded (customer-portal team vs. organization/tenant); consider "organization" or "tenant" instead. Note: a Teams API is already built. *(owner: team)*
- [ ] **Project name scheme** — nature words (e.g. "River") vs. random words for generated project names. *(owner: Julia)*
- [ ] **Later** — user-list filter to distinguish end-users from admin/account users. *(future)*
---
## Decisions
### D28 · Accessibility is guaranteed for default templates only — 2026-08-19 · [standing]
We render our own accessible components and ensure the default templates work — that's what we guarantee (aim: WCAG AA, the level Okta/Auth0 commit to; nobody guarantees AAA). The moment a customer overrides a template with custom markup, the appearance variables no longer apply and accessibility is theirs. Must be stated in the docs and API docs. Two follow-ups: a contrast warning in Appearance (the only thing users can really break is text-on-background contrast, in light *and* dark mode), and a Lighthouse accessibility check in CI so a regression fails the build.
→ Julia specs the contrast warning; eng evaluates Lighthouse in CI.
### D27 · Appearance gets a JSON/YAML view — 2026-08-19
Appearance is configuration and comes out of the API as a schema, so show the raw output the same way flows do. Customers replacing the default template need to know what the API gives them. Reuse the existing JSON/YAML toggle component.
### D26 · Five built-in login layouts — 2026-08-19
The layouts a user can pick while scaffolding: centered, minimal, split, split reverse, hero. They already render in the CLI-scaffolded login (Flo built them, Liam updated them for the new login — it's purely how the divs are aligned; the form components are the current designed ones). The shadcn library already covers most of these in Figma; the hero layout is the gap. The existing hero variant needs redesigning — the image should be a full background/section, not a picture placed behind a headline.
→ Julia designs hero + updates the layout variants; Liam walks through the running versions.
### D25 · Appearance is read-only for Alpha — 2026-08-19 · [standing]
The Appearance section previews what's set in code: layout, colours & typography, logo / hero / background imagery, text content (headings, descriptions, button labels), and the layout options of the chosen design. Switchable across sign-up, password login, passkey login, passkey registration and the validation/error states, with a light/dark toggle and a rendered preview plus code. Branding is the rare case where a visual representation in the console genuinely earns its place — but editing comes later, once we know how console-vs-code editing should work at all. Language: English only for now; custom languages stay client-side.
### D24 · Schema list stays as it is — 2026-08-19
Question raised: now that users, projects and teams all use the same table, should the schema list become a table too (name, fields, authentication, created) instead of the directory/card view? Decision: no, not now. It's already built, and we shouldn't iterate on something we haven't released — ship the first iteration, then ask users whether the different representation bothers them. Revisits, but does not overturn, D0a.
### D23 · Metadata block on every detail view — 2026-08-19 · [standing]
The flow detail carries flow ID + created + last changed as meta items; add the same block to the schema detail. Detail pages should share interface rules, interaction patterns and information positions regardless of resource.
### D22 · Flow steps show actions, not just fields — 2026-08-19
The steps table lists fields *and* actions, showing each action's kind or name (e.g. `submit`, `passkey`). Rationale (Max): you open a flow to answer "is my flow correct?" — a table that only shows fields forces you to read the table *and* scroll the JSON. Most actions are navigation (`submit` on every step, so it reads repetitive), but passkey triggers matter and omitting them makes the table a misleading interpretation of the flow.
→ Julia adds actions to the steps table; Vitor shared an example of the action kinds in chat.
### D21 · Flows list is a table — 2026-08-19
Flows follow the users/sessions/teams table pattern rather than the drill-down card view. Columns: name, purpose, connected user schema, last changed. Last changed, not created date — more relevant to the user. Purpose and user schema still have to be exposed on the API (the contract currently has name and status only) — small change, likely a quick win. The detail keeps steps, code block and metadata, and states the connected user schema as a link straight through to that schema. Card-style drill-down broke down here: those fields are too hard to read in that form. Future iteration: a static diagram of the step connections next to the flow.
### D20 · Toasts are the standard notification pattern — 2026-08-19 · [standing]
Sonner toasts for invite sent, invite revoked, invite resent, member removed and "you left <team>" — and for creating/adding anything else. They stack and dismiss themselves after a set time. Confirmation modals stay for the destructive actions (remove, revoke); resending needs no confirmation.
### D19 · Admin list actions: remove, revoke, resend — 2026-08-19
Resend invite is in, even though the issue scoped it out: without it, a lost invitation forces you to delete and re-invite. Remove shows a confirm modal — "they immediately lose access to this team's project, their user account isn't deleted, and their other team memberships aren't affected" — slightly verbose, but unambiguous. Revoke tells the user the invitation stops working; exact wording depends on the invite mechanism (open question above).
### D18 · One role for now: project admin — 2026-08-19
Claiming makes you project admin; anyone you invite is also project admin. The owner/admin split comes out of the members table for now, along with the "a team needs at least one owner" rule — that idea is kept for later (two roles make the last-admin problem solvable by requiring an owner). Doesn't solve the last-admin problem in the meantime; see open questions.
### D17 · Settings is its own area: account vs. workspace — 2026-08-12 · re-confirmed 2026-08-19 · [standing]
Settings opens from the user popover at the bottom of the sidebar and swaps in a dedicated settings navigation with a way back to the app — the Vercel/Linear pattern — reserving room for the many settings items still to come. Two sections from the start: account/personal (profile) and workspace (members/admins; teams later). Settings pages run narrower than portal pages so input fields align — these pages are for changing values, not displaying them.
### D16 · Profile settings show email only — 2026-08-12 · re-confirmed 2026-08-19
Claiming asks for nothing but an email address, so there is no first/last name to edit — and the email can't be changed either, so even that field is read-only. The emptiest interface we've shipped. No delete-account or leave-team actions yet, and no user-schema fields pulled in. Revisit once SSO can supply profile data, or when billing needs more (name, billing address) from cloud customers.
### D35 · Invitations hold only an email — 2026-08-12
An invitation is not a user: there's no schema behind it, just the email address needed to send it; the user object is created only when the invite is accepted (via claiming). So the invite modal asks for the email only, and pending rows are essentially email rows. Later, internal invitations can become schema-based (an internal/team schema deciding what to collect). Copy: members are removed "from this project" — not "organization".
### D34 · Session detail: minimal, one view — 2026-08-12
Cut the rich metadata down to what answers "it works, this is the user, this is how they authenticated": authentication factors with their Verified timestamps, plus IP address and user agent (network *and* device). Everything else waits for real demand — this page isn't threat-hunting yet. User information reuses the user-detail component rendered read-only (all schema attributes are fetchable from the session). No tabs or toggles — bare information in one view. The page title follows the display-name logic (D30). Wording: keep "Verified" (= when that factor was entered during authentication); "logged in" would wrongly imply the whole authentication completed even when an MFA step follows. Revisit if users stumble over it.
### D33 · Revoked sessions leave the list — 2026-08-12
Revoke stays as the session action; a revoked session disappears from the list rather than lingering with a revoked state — the audit log is where you find it afterwards. Revoking needs a confirm modal: the session is terminated immediately and the user has to authenticate again to start a new one.
### D32 · No search anywhere in the MVP — 2026-08-12
Drop the search field console-wide, not just per page: at test scale there's a handful of users and sessions, the current field is static anyway, and search deserves a global concept before it returns (see open question). Extends D5's no-filter/no-sort stance.
### D31 · Session list: name, email, user ID — 2026-08-12
Sessions don't render schema columns (that's the user list): the API returns name and email, matched best-effort by property name on the backend — fragile, acceptable. Name combines given + family name into one field. Company column removed — a session listing is not a user-schema listing. The user ID joins the table as identifying info at the front of the row: it correlates sessions of the same user even when name matching comes up empty (machine users).
### D30 · Display name: given + family name → email → user ID — 2026-08-12
Already merged: the front end derives a display name from given/family name if present, falls back to email, then to user ID — the same logic everywhere a user is titled (user detail, session detail). Good enough for now; machine accounts will mostly end at the ID. The real solution — an identifier/display-name annotation in the schema — is a parked open question.
### D29 · User list ships as the raw merged table — 2026-08-12
With multiple schemas, the list shows every column of every schema in one table; users without a property get a dash, horizontal scroll takes the width (per D4/D5). Explicitly ship the "mumbo jumbo" and let people react, rather than pre-solving the five possible display fixes now — claiming is close, the dynamic columns are already built (twice), and unreleased work shouldn't grow scope. Column order arrives random from the backend (unordered map); the front end sorts alphabetically as a stopgap, proper (schema-defined) ordering needs its ticket.
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
## Follow-ups from 2026-08-19
- Julia: add actions (kind/name) to the flow steps table; add the metadata block to the schema detail.
- Julia: redesign the hero layout and update the login layout variants; get the comprehensive list of layout options.
- eng: expose purpose + connected user schema on the flows list API (quick win — the flow screens are the next thing to build, the APIs are otherwise there).
- Sylvana / eng: decide the invite mechanism; the members copy stays provisional until then.
- Team: hosted preview environment (Flo + Marco) so work in progress is visible without running it locally — right now nobody sees what's built. Use the design sharing sessions to demo built screens, not just Figma.
- Liam back 2026-09-01; Max picks up his workstreams in the meantime. Portal responsiveness walkthrough scheduled for then.
## Follow-ups from 2026-08-12
- Liam: rebuild the login on shadcn components next (claiming is API-blocked anyway; the current drop-in web-component login drifts visually from the rest) — sync with Max.
- Julia: translate the pre-shadcn login designs into components — needed for the invited-user sign-up flow.
- Julia: align the member-delete confirmation with the existing delete patterns (the live version differs from the mock — check against the type-"delete" pattern, D2).
- eng: ticket for schema-defined column ordering (front-end alphabetical sort is the stopgap).
---
<!-- New decision: copy this, bump the ID.
### D36 · <decision> — YYYY-MM-DD
<one line on why>
→ <next step, who>
-->
