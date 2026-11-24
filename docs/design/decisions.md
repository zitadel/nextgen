# Design Decisions

> [!NOTE]
> The [Console UI pattern guides](console/ui-patterns/README.md) expand the reusable design targets recorded in D47 and D48 below. The guides are design specifications, not evidence of implementation; [Console styling](../../apps/console/docs/styling.md) remains the technical baseline until the implementation and documentation are reconciled. This decisions log remains active.

---

## Open questions

- [ ] **Project & multi-project access** — parked on the permissions foundations (Livio, Sylvana); not needed for MVP. Once ready, the project selector removed in D6 comes back in the role-assignment UI. *(owner: eng)*
- [ ] **Admin vs. end-user permissions** — separation of instance/Zitadel-admin roles from end-user roles, tied to the same permissions work. *(owner: eng)*
- [ ] **Schema status & versions** — confirm with Vitor (Mon): backend currently has only a "latest" flag — no active/inactive status and no revisions object. Is active/inactive available? *(owner: Julia)*
- [x] **Projects in navigation** — main nav (key-resource consistency) vs. top context dropdown only. Depends on whether the API can list multiple projects (no API design yet); may be skipped for MVP since there's only one project. *(owner: Julia / eng)* → Resolved by D27: the account sidebar, with the top context dropdown and the logo.
- [ ] **"Team" naming** — overloaded (customer-portal team vs. organization/tenant); consider "organization" or "tenant" instead. Note: a Teams API is already built. *(owner: team)*
- [ ] **Project name scheme** — nature words (e.g. "River") vs. random words for generated project names. *(owner: Julia)*
- [ ] **Environment lifecycle & default set** — `dev`, `staging`, and `prod` are currently seeded as a temporary implementation detail, not a required deployment pipeline. Define whether projects can start with one or multiple environments, custom names, and how create / rename / retire works. See #528 / #965. *(owner: product / eng)*
- [ ] **When are environment-specific IDP credentials captured?** — the connection is environment-independent and credential values belong to the target environment, but it is still open whether the CLI asks for them during provider setup, after selecting an environment, or only when a deploy finds required values missing. This must also work when production credentials do not exist yet during initial setup. *(owner: CLI / eng / design)*
- [ ] **Variables/secrets across deployments and rollback** — clarify whether environment values are snapshotted per deployment, what happens when a secret is rotated, and which values a rollback resolves. Also clarify whether snapshotting is purely backend behavior or affects the CLI model. *(owner: eng)*
- [ ] **IDP delete semantics** — define what deleting an IDP connection means when it may be referenced by one or more user schemas / flows. Delete may be deferred from the first iteration until those semantics are defined. *(owner: product / eng)*
- [ ] **Enterprise SSO naming & downstream configuration surface** — settle the product terminology (e.g. "Enterprise SSO" vs. another term) and the concrete downstream-admin surface: embeddable component/module, API, or both. Do not assume the ZITADEL Console is the required surface. *(owner: team)*
- [ ] **Font loading for Zitadel-served login** — `font_url` property vs. a hosted font picker vs. custom CSS overrides; needs a CSP answer before it can be designed. *(owner: Max)*
- [ ] **Relative vs. absolute asset paths** — a relative logo path typed into the console resolves against the customer's app, not the console; decide what we validate and how the field explains it. *(owner: Max)*
- [ ] **Code ↔ console sync** — the CLI can publish but has no `fetch`/`pull`, so a console edit and a local `branding.json` can silently diverge. Blocks making branding editable (D75). *(owner: eng)*
- [ ] **Environments & releases** — how a branding change travels deploy → environment → production, and what that means for the branding screen. Workshop being scheduled. *(owner: Vitor)*
- [ ] **Named themes beyond light/dark** — the schema should later take e.g. a "navy" theme; not in this iteration, but the contract must not close the door. *(owner: Max)*
- [ ] **Last-admin protection** — you can currently remove every admin, leaving the account without one. Tim says enforcing "can't delete the final role" is hard because roles are flexible; asked whether the API can block it temporarily so we don't build on a broken default. Design shows remove/revoke as if it were unrestricted until confirmed. Spec issue incoming. *(owner: eng / Tim)*
- [x] **How invites are delivered** — three options on the table: (a) temp email service that creates the user and mails credentials + a reset-password service on first login, (b) an automation listening to the "user invited" event that triggers an invite mail, (c) show a generated password in the UI after inviting and let the inviter forward it manually. A fourth idea came up in the call: a shareable invite link (needs generation + expiry). No transactional email infrastructure exists today. Blocks the modal copy — "their sign-up link stops working" is only correct for the link option. *(owner: Sylvana / eng)* → Resolved: an invitation is a link the inviter shares (#2978).
- [ ] **Console login: dogfooding & customization** — the console uses the same login we sell as a product (Alex and Olivia want exactly that), but the login-v2-in-cloud lesson applies: a shared login you can't customize means you can't change anything without changing it globally. Needs a customization story — "sooner rather than later", and it's not API-blocked. *(owner: Liam / Max)*
- [x] **Display names, long-term** — the given name + family name → email → user ID fallback (D56) is a stopgap. A proper solution (e.g. a schema annotation marking the identifier/display attribute — existed once, was dropped as unused; machine accounts need a configurable display name) is needed everywhere users appear: teams, sessions, activity log ("an ID is useless when you're investigating"). Deliberately parked until the raw version is out and people react. *(owner: team)* → Resolved by ADR 058: a schema designates `x-display` and `x-identifier`.
- [x] **Search as a global concept** — dropped from the MVP everywhere (D58); before it returns, define how search should behave console-wide (plain text filter vs. advanced criteria, inside the table vs. above it vs. the overarching search) instead of per-page one-offs. *(owner: Julia / team)* → Resolved by D32, D37 and D39.
- [ ] **Appearance placement in navigation** — currently modelled as a top-level nav item. Counter-argument (Max): branding belongs to the login journey — you define flows, then style them — so it should sit with Login flows. Possible middle ground: a main-nav group holding Flows / Authentication / Appearance. Not decided; deliberately parked. *(owner: Julia / team)*
- [ ] **Appearance: what's code-managed vs. client-side** — layout/template, logo and hero image URL look like server-side schema; colours, fonts and CSS look like client application. Needs clarifying before the read-only preview can claim to show "everything". *(owner: Julia / Vitor)*
- [ ] **Layout options per template** — "basic layout options provided by the selected design" is undefined. Need a comprehensive list of what each of the five built-in layouts includes (e.g. logo placement). No issue describes them yet. *(owner: Julia / eng)*
- [ ] **Editing branding in the console** — if config lives in code but is editable in the console, we need a sync story (a `sync` command was floated and immediately flagged as re-inventing git). Explicitly deferred: read-only first, revisit when we know whether users actually want to do it locally. *(future)*
- [ ] **Light/dark switch in the login** — the dev-only toggle is still in; open whether it stays as a user-facing switch or follows the system setting. *(owner: Julia / Liam)*
- [ ] **Login vs. console visual alignment** — whether to fully restyle the login flow to match the console (CTA height, labels, button styles differ today) or keep it slightly different for MVP. Parked; revisit once light/dark tokens land. *(owner: design / eng)*
- [x] **Applications** — no owner identified and no backend mention yet. Design to ask around for who owns applications. *(owner: design)* → Resolved: applications are in the API and the console (#3214).
- [ ] **Glossary + data model** — the team wants a vocabulary table (term → the real thing in the mechanic) plus an ER / data-model diagram, ideally generated from the DB once it's settled. Needed to keep the tenant/team/project terminology unambiguous. *(owner: eng / design)*
- [ ] **User membership vs. roles** — when adding a user, which tenant(s)/project(s) they belong to and the role within each is still tangled (multi-select of teams/projects + per-context role). Revisit when building the add-user UI; not resolved by the tenant rename. *(owner: design / eng)*
- [ ] **Later** — user-list filter to distinguish end-users from admin/account users. *(future)*

---

## Decisions

### D92 · Enterprise SSO configuration must reach the customer's customer — 2026-09-09
B2B / Enterprise SSO has a different configuration boundary from social login. The ZITADEL operator can configure or enable the capability, but a downstream customer's admin must be able to configure their own SAML/OIDC connection without using the ZITADEL CLI.

That configuration surface belongs in the ZITADEL customer's product and may be provided through an embeddable component/module or API; it is not assumed to be the ZITADEL Console.

→ Keep exact naming and delivery mechanism open.

### D91 · CLI is command-driven, not workflow-driven — 2026-09-09 · [standing]
The post-claim CLI should optimize for direct commands, good defaults, validation, developers, automation, and agents — not a state-machine / terminal UI that walks users through long end-to-end wizards.

Users should be able to enter at the command relevant to their task. Interactive prompts can support individual commands but are not the primary architecture.

→ Rework guided CLI journeys accordingly, including the current IDP setup concept.

### D90 · Deployment review belongs inside deploy — 2026-09-09
Do not expose "Review deployment" as a separate action.

The user chooses Deploy; the relevant changes / diff are shown as part of that operation before confirmation.

This keeps reviewing attached to the action that will actually make the configuration live and aligns with the removal of a separate `plan` step.

### D89 · One deployment workflow; no separate promotion flow for MVP — 2026-09-09
Deploying an existing release onto another environment is the same underlying deployment operation as deploying it anywhere else.

For MVP, do not introduce a separate user-facing promotion workflow. The user selects the release, selects the target environment, reviews the change, and deploys it.

A dedicated `promote` helper may be reconsidered later if actual usage shows that it adds value.

→ Align the CLI direction in ADR 035 and #539 with this decision. The underlying release / environment / deployment architecture remains unchanged.

### D88 · Environment order is not enforced — 2026-09-09 · [standing]
Do not require a fixed `dev → staging → prod` progression.

A deployment explicitly targets an environment; users may deploy directly to whichever environment they need.

The currently seeded `dev`, `staging`, and `prod` environments are temporary implementation scaffolding, not a mandatory product workflow.

### D87 · IDP configuration is environment-independent; credential values are not — 2026-09-09 · [standing]
An IDP connection is configuration that can travel unchanged with a release.

Credential values required by that connection are resolved for the target environment rather than baked into the connection or release. Secret values are not stored in the connection configuration.

For MVP, values do not need to be automatically copied between environments; requiring missing target-environment values again is acceptable.

→ Exact credential-capture timing remains open.

### D86 · IDP connections are reusable across user schemas — 2026-09-09
An identity-provider connection is a centrally managed configuration object, not configuration nested under one user schema.

The same connection can be enabled for multiple user schemas / authentication flows and should be reused rather than duplicated per schema.

Users may conceptually approach configuration from either the user-schema side or the provider side; both operate on the same underlying connection.

### D85 · Branding customization targets the login widget, not the page — 2026-09-02 · [standing]
Everything in the branding scope applies to `<zitadel-login>` — the card, its fields, buttons and type. The page around it (split screen, hero, marketing copy) belongs to the customer in the embedded model and to page templates/chrome in the Zitadel-served model. Two different products; don't mix their knobs into one settings screen.

### D84 · Ship the whole branding property set at once — 2026-09-02
Drop the idea of staging the API by customization level (the L1 / L2 / full-control tiering). The design system and palette already exist, so a "basic subset" API saves no implementation time — and every property we hold back is a future contract conflict. Ship the full object from #1046, designed for extensibility (named themes, per-element shape), and let the console expose a subset. *(Max)*
→ Max adds the follow-ups to #1046 and marks it ready to implement; Vitor reviews before the API work starts.

### D83 · Basic vs. advanced is a console grouping, not a permission or API split — 2026-09-02
Anyone allowed to edit branding may edit every property — no restricted tier. The console instead hides the secondary palette (surface, muted, border, link, success/warning/error) behind collapsibles/an advanced mode, grouped by where the colors are actually used and with a short description each. Success/warning/error get a hint that leaving the defaults means leaving the accessible path.

### D82 · Basic is a subset, not combined inputs — 2026-09-02
The basic view shows the real properties (primary color, logo per mode, body font, radius), just fewer of them. Anything hidden stays at its maintained default — no derived or bundled inputs behind a single control. A primary color on the default background has to look fine on its own.

### D81 · Theme mode decides which palette sections the console shows — 2026-09-02
`theme.mode` isn't only a preview toggle: light-only hides the dark palette, dark-only hides the light one, auto/system shows both. Today's screen always shows both, which is how customers ended up tuning dark values into the light theme and shipping black text on a dark surface.

### D80 · The console warns on contrast, it doesn't block — 2026-09-02
We own the design system and know which token lands on which surface, so the console can compute the contrast for each pair and flag the ones that fail. Show a warning next to the offending value ("you're using the light theme with a dark background") — no hard validation, no auto-correction.

### D79 · No asset uploads — logos and images are strings — 2026-09-02 · [standing]
`logo_url` and any later image property take a path or URL that the customer hosts, following Auth0. Avoids blob upload APIs, size limits, format rules and SVG script injection — and the embedded widget only ever applies the string anyway. The console therefore shows the path, not a thumbnail.

### D78 · Font family is a name; the customer loads the font — 2026-09-02
`typography.font_family` is a free-text input (not a dropdown of hosted fonts). The widget renders inside the customer's application, so the font is already loaded there and their CSP governs it — we only say which family the headings and body use. No font hosting and no `font_url` for embedded login in this iteration.

### D77 · No branding preview in the console (embedded login) — 2026-09-02
The console can't render a truthful preview: it doesn't have the customer's fonts, relative asset paths resolve against their app, and local code overrides always win. Editing loop is: change the value in the console, reload your own login route — the widget pulls the config from the API. Preview becomes a real question once Zitadel-served login exists.

### D76 · Page background stays out of branding — 2026-09-02
Repeated Auth0/login-v2 request, but in the embedded model we don't own the page background. What customers actually want to restyle is the card, which is `surface`. Background belongs to the page templates/chrome and is authored in Liquid.

### D75 · Branding ships read-only in the console — 2026-09-02
Same posture as schemas and flows (D0b): code is the source of truth, the console displays. Editable branding needs the revision/deploy lifecycle and a CLI `fetch`/`pull` — without them, editing in both places drifts and there's no answer for out-of-sync. Design the full editable screen now and ship it with the controls disabled, so it can be switched on as soon as revisions land. *(Vitor)*
→ Vitor schedules the environments & releases workshop (Fri or next week) so design knows the lifecycle.

### D74 · Accessibility is guaranteed for default templates only — 2026-08-19 · [standing]
We render our own accessible components and ensure the default templates work — that's what we guarantee (aim: WCAG AA, the level Okta/Auth0 commit to; nobody guarantees AAA). The moment a customer overrides a template with custom markup, the appearance variables no longer apply and accessibility is theirs. Must be stated in the docs and API docs. Two follow-ups: a contrast warning in Appearance (the only thing users can really break is text-on-background contrast, in light *and* dark mode), and a Lighthouse accessibility check in CI so a regression fails the build.
→ Julia specs the contrast warning; eng evaluates Lighthouse in CI.

### D73 · Appearance gets a JSON/YAML view — 2026-08-19
Appearance is configuration and comes out of the API as a schema, so show the raw output the same way flows do. Customers replacing the default template need to know what the API gives them. Reuse the existing JSON/YAML toggle component.

### D72 · Five built-in login layouts — 2026-08-19
The layouts a user can pick while scaffolding: centered, minimal, split, split reverse, hero. They already render in the CLI-scaffolded login (Flo built them, Liam updated them for the new login — it's purely how the divs are aligned; the form components are the current designed ones). The shadcn library already covers most of these in Figma; the hero layout is the gap. The existing hero variant needs redesigning — the image should be a full background/section, not a picture placed behind a headline.
→ Julia designs hero + updates the layout variants; Liam walks through the running versions.

### D71 · Appearance is read-only for Alpha — 2026-08-19 · [standing]
The Appearance section previews what's set in code: layout, colours & typography, logo / hero / background imagery, text content (headings, descriptions, button labels), and the layout options of the chosen design. Switchable across sign-up, password login, passkey login, passkey registration and the validation/error states, with a light/dark toggle and a rendered preview plus code. Branding is the rare case where a visual representation in the console genuinely earns its place — but editing comes later, once we know how console-vs-code editing should work at all. Language: English only for now; custom languages stay client-side.

### D70 · Schema list stays as it is — 2026-08-19 · [superseded by D17]
Question raised: now that users, projects and teams all use the same table, should the schema list become a table too (name, fields, authentication, created) instead of the directory/card view? Decision: no, not now. It's already built, and we shouldn't iterate on something we haven't released — ship the first iteration, then ask users whether the different representation bothers them. Revisits, but does not overturn, D0a.

### D69 · Metadata block on every detail view — 2026-08-19 · [standing]
The flow detail carries flow ID + created + last changed as meta items; add the same block to the schema detail. Detail pages should share interface rules, interaction patterns and information positions regardless of resource.

### D68 · Flow steps show actions, not just fields — 2026-08-19
The steps table lists fields *and* actions, showing each action's kind or name (e.g. `submit`, `passkey`). Rationale (Max): you open a flow to answer "is my flow correct?" — a table that only shows fields forces you to read the table *and* scroll the JSON. Most actions are navigation (`submit` on every step, so it reads repetitive), but passkey triggers matter and omitting them makes the table a misleading interpretation of the flow.
→ Julia adds actions to the steps table; Vitor shared an example of the action kinds in chat.

### D67 · Flows list is a table — 2026-08-19
Flows follow the users/sessions/teams table pattern rather than the drill-down card view. Columns: name, purpose, connected user schema, last changed. Last changed, not created date — more relevant to the user. Purpose and user schema still have to be exposed on the API (the contract currently has name and status only) — small change, likely a quick win. The detail keeps steps, code block and metadata, and states the connected user schema as a link straight through to that schema. Card-style drill-down broke down here: those fields are too hard to read in that form. Future iteration: a static diagram of the step connections next to the flow.

### D66 · Toasts are the standard notification pattern — 2026-08-19 · [standing]
Sonner toasts for invite sent, invite revoked, invite resent, member removed and "you left <team>" — and for creating/adding anything else. They stack and dismiss themselves after a set time. Confirmation modals stay for the destructive actions (remove, revoke); resending needs no confirmation.

### D65 · Admin list actions: remove, revoke, resend — 2026-08-19
Resend invite is in, even though the issue scoped it out: without it, a lost invitation forces you to delete and re-invite. Remove shows a confirm modal — "they immediately lose access to this team's project, their user account isn't deleted, and their other team memberships aren't affected" — slightly verbose, but unambiguous. Revoke tells the user the invitation stops working; exact wording depends on the invite mechanism (open question above).

### D64 · One role for now: project admin — 2026-08-19
Claiming makes you project admin; anyone you invite is also project admin. The owner/admin split comes out of the members table for now, along with the "a team needs at least one owner" rule — that idea is kept for later (two roles make the last-admin problem solvable by requiring an owner). Doesn't solve the last-admin problem in the meantime; see open questions.

### D63 · Settings is its own area: account vs. workspace — 2026-08-12 · re-confirmed 2026-08-19 · [amended by D29 and D40]
Settings opens from the user popover at the bottom of the sidebar and swaps in a dedicated settings navigation with a way back to the app — the Vercel/Linear pattern — reserving room for the many settings items still to come. Two sections from the start: account/personal (profile) and workspace (members/admins; teams later). Settings pages run narrower than portal pages so input fields align — these pages are for changing values, not displaying them.

### D62 · Profile settings show email only — 2026-08-12 · re-confirmed 2026-08-19 · [superseded by D16]
Claiming asks for nothing but an email address, so there is no first/last name to edit — and the email can't be changed either, so even that field is read-only. The emptiest interface we've shipped. No delete-account or leave-team actions yet, and no user-schema fields pulled in. Revisit once SSO can supply profile data, or when billing needs more (name, billing address) from cloud customers.

### D61 · Invitations hold only an email — 2026-08-12
An invitation is not a user: there's no schema behind it, just the email address needed to send it; the user object is created only when the invite is accepted (via claiming). So the invite modal asks for the email only, and pending rows are essentially email rows. Later, internal invitations can become schema-based (an internal/team schema deciding what to collect). Copy: members are removed "from this project" — not "organization".

### D60 · Session detail: minimal, one view — 2026-08-12
Cut the rich metadata down to what answers "it works, this is the user, this is how they authenticated": authentication factors with their Verified timestamps, plus IP address and user agent (network *and* device). Everything else waits for real demand — this page isn't threat-hunting yet. User information reuses the user-detail component rendered read-only (all schema attributes are fetchable from the session). No tabs or toggles — bare information in one view. The page title follows the display-name logic (D56). Wording: keep "Verified" (= when that factor was entered during authentication); "logged in" would wrongly imply the whole authentication completed even when an MFA step follows. Revisit if users stumble over it.

### D59 · Revoked sessions leave the list — 2026-08-12
Revoke stays as the session action; a revoked session disappears from the list rather than lingering with a revoked state — the audit log is where you find it afterwards. Revoking needs a confirm modal: the session is terminated immediately and the user has to authenticate again to start a new one.

### D58 · No search anywhere in the MVP — 2026-08-12 · [superseded by D32]
Drop the search field console-wide, not just per page: at test scale there's a handful of users and sessions, the current field is static anyway, and search deserves a global concept before it returns (see open question). Extends D5's no-filter/no-sort stance.

### D57 · Session list: name, email, user ID — 2026-08-12
Sessions don't render schema columns (that's the user list): the API returns name and email, matched best-effort by property name on the backend — fragile, acceptable. Name combines given + family name into one field. Company column removed — a session listing is not a user-schema listing. The user ID joins the table as identifying info at the front of the row: it correlates sessions of the same user even when name matching comes up empty (machine users).

### D56 · Display name: given + family name → email → user ID — 2026-08-12 · [superseded by ADR 058's `x-display`]
Already merged: the front end derives a display name from given/family name if present, falls back to email, then to user ID — the same logic everywhere a user is titled (user detail, session detail). Good enough for now; machine accounts will mostly end at the ID. The real solution — an identifier/display-name annotation in the schema — is a parked open question.

### D55 · User list ships as the raw merged table — 2026-08-12 · [superseded by D23]
With multiple schemas, the list shows every column of every schema in one table; users without a property get a dash, horizontal scroll takes the width (per D4/D5). Explicitly ship the "mumbo jumbo" and let people react, rather than pre-solving the five possible display fixes now — claiming is close, the dynamic columns are already built (twice), and unreleased work shouldn't grow scope. Column order arrives random from the backend (unordered map); the front end sorts alphabetically as a stopgap, proper (schema-defined) ordering needs its ticket.

### D54 · Login UI: pure CSS on own tokens, not shadcn/ui — 2026-08-05 · [standing]
The login app has to run inside many different frameworks and is built as web/lit components, so it can't use the shadcn/ui React library or Tailwind. Rebuild it with pure CSS that maps the design tokens to our own CSS classes (the original "legacy" / `zl-`-prefixed token approach), not shadcn or Tailwind classes. Reuse the same token styles for visual consistency, but add a prominent note in Figma and in code: *"don't use shadcn — the CSS is done manually."* There is no light theme in these variables today. → Design provides light + dark mode values and applies them to the correct color tokens; whether to fully align the login look with the console is a separate open question.

### D53 · Schema nested attributes show the whole schema — 2026-08-05
Clicking a nested attribute (e.g. `address`) does not drill into a partial view or scroll to just that attribute — always display the full schema, because a schema is applied as a whole. Refines D14. Schemas stay view-only / apply-locally (D0b).

### D52 · Tenant list & detail (renamed from teams) — 2026-08-05 · [not carried out: the console and the API still say "team"]
Tenants reuse the user-list pattern: name, status, creation date; searchable; toggle by active/inactive status; "add tenant" opens the right-side drawer (D15) and lands back on the list with a success toast. The three-dot context menu is minimal for now — "view resource" only (delete, turnkey, and other sub-actions come later, consistently everywhere). Tenant detail: tenant name (editable), tenant ID (renamed from "team ID"), primary domain, creation date. Generate an identicon-style icon for tenants (à la GitHub / Vercel) rather than picking a fixed org glyph.

### D51 · Projects: drop "owning team"; claiming ≠ new tenant — 2026-08-05
Confirms D11's "no owning-team label": ownership is implicit (single context, one visible team), so the field is removed and not editable. Keep the (now lighter) info box — more fields will come later. Project detail keeps project ID, issuer URL, created date, and an editable project name. Claiming another project via onboarding adds that project to your account/team; it does **not** create a new tenant — a tenant belongs to a project. MVP: multiple tenants are possible, but only one project.

### D50 · Term / data model: project = instance, tenant = organization, team = account — 2026-08-05 · [not carried out: the console and the API still say "team"]
Same backend JSON model as today — only the words change. Hierarchy: a project (the instance, e.g. "River") contains one or more tenants (organizations, e.g. "Acme"); the account "team" (the Zitadel cloud account, shown bottom-left, holding account users / billing) sits above. "Multi-tenancy" = a project is multi-tenant-capable; tenants live within a project. → The team wants a glossary (term → real mechanic) and an ER / data-model diagram generated from the DB once it's settled (see open questions).

### D49 · Naming: "tenant" for the organization; "team" reserved for the account side — 2026-08-05 · [not carried out: the console and the API still say "team"]
Resolves the parked "Team" naming question. The organization concept (the multi-tenant org living inside a project) is now called **tenant** everywhere in the UI — "organization" was the alternative, but "tenant" matches how we sell it (multi-tenancy) and how customers already think. "Team" stays reserved for the account / cloud-account side (account users: owner, admin, billing), shown bottom-left. Renaming teams → tenants in the UI does not touch the underlying model, only the labels (tenant ID, add tenant, etc.). Going with it now per the "if you're opinionated, ship it and we can change it later" guidance; will still surface it as a Slack mention/poll, but proceeding so MVP work isn't blocked. → Design updates the UI and this MD; flag if a root problem surfaces.

### D47 · Reusable Console UI polishing patterns — 2026-11-23 · [standing]
The seven [UI-01–UI-07 guides](console/ui-patterns/README.md) are the approved reusable design targets and verification criteria for Console polishing. They do not change code or supersede valid product, routing, accessibility or backend contracts. `apps/console/docs/styling.md` remains the description of current technical implementation; an implementation PR must reconcile changed components and that baseline together.

The approved differences from the current technical baseline are: **44px** resource-list headers with `muted-foreground` labels for comfortable density (preserving **56px** body rows and existing **40px** compact lists); resource-name and secondary-reference links without hover underline (secondary references change from muted to foreground on hover); **vertical** row-menu ellipsis; and **12px monospace** resource identifiers where applicable, retaining the existing layout-aware middle truncation and full-value Copy. Preserve table widths, pinned columns, native link behavior and focus affordances. Do not apply resource-list header changes to panel-table heads or compact Events.

The guides also record shared targets for real-route row navigation; actionable `+N` overflow; externally directed link indications; consistent page title → optional truthful metadata → content; field-semantic date/time formatting and the existing 24-hour relative rule; existing Card/Badge semantics; first-use versus filtered-empty feedback; contextual success/error/loading behavior; optional-field markers, blur/submit validation and useful helper placement; **FormSheet for Create**, while existing detail-page edits remain inline unless separately decided; and explicit destructive confirmations. These are reusable patterns, not authorization to redesign screen-specific columns, navigation, permissions, API states or page widths. Existing relevant D-decisions (including D5, D13, D15, D19, D27, D35, D40 and D41) still apply. Users-specific changes are D48.

### D48 · Users table exposes Columns and uses schema-resolved identity — 2026-11-23 · [standing]
Amends **only** D23's right-click-only Columns affordance and its mandatory identifier-property chip. The Users table exposes a visible text-labelled **Columns** control at the right of its table toolbar, while existing optional-property pinning remains available; the reviewed primary identity is the server-resolved `x-display` name with the designated `x-identifier` beneath (ID as fallback; ADR 058 §3a), without redundant property-type chips. The existing **ID column** remains independent of the user's identifier property. Preserve D23's column-width and horizontal-scroll rules, pinned properties, Attributes popover, sticky row action and the relevant identity card. This is a design target; implementation PRs, including any already open Users-table work, must align with it separately.

### D46 · Events' rows lead with the time, and an open event stands beside the list — 2026-11-13
Amends D30 and D45. A pass on the team's comments, measured against Vercel's Logs, which Events follows (D30). Supabase's log explorer was the other reference raised; its filters stand in a second column beside the navigation, and Events keeps its one sidebar that swaps to its own list, as Vercel's does.
Vercel's rows lead with the time (`NOV 13 11:23:29.02`), go on with the short columns and end in the free text, and its panel opens under the toolbar and over the tail of the rows, so no control and no leading column is hidden. Events' drawer is a sheet, full height and 520px wide, and its rows ended in the time: at 1440px an open event hid the Actor and Time columns, the row menus, Live, Refresh and Export and two fifths of the search field, whose suggestions opened as wide as the field and so across the drawer.
Rows now lead with Time: the day, then the clock time to the millisecond. The year is written only for a day older than eleven months; the whole moment is on hover and in the drawer. The API requests view has the request's own columns, as Vercel's Request Logs have: method and operation, status, duration and actor, in place of an Event column that read `request.api` on every row. From `xl` (1280px), where the two fit side by side, the list's page ends a gutter before the drawer (`Page`'s `besideSheet`), and the table scrolls in its card with the time and the type in view. Narrower, the drawer still covers the list's right, and the search's suggestions end where the drawer starts.
The drawer's body follows the form sheets (D15, the Deploy release sheet): its parts 16px either side of a rule, under the sheets' 14/20 heading in place of a page card's 16/20. An empty list under a user, operation or status filter says that events recorded before the server had the filter are not matched (root ADR 048 leaves them unfilled), since an event of that age still offers the filter. A filter's prefix typed without its value (`actor:`) is no longer read as an ID.
The sidebar's filters are groups, as Vercel's are: a filter's name folds its control away, and folded over a value it says how many are set. A filter of a few values shows them all as checkboxes, any number ticked and none meaning every one: the categories, a request's status classes with what each means, and how a sign-in ended. So Category and Outcome take several values, as Status did, each one range of an index; a link with one value still reads. The time stays a list to choose from and the types, some fifty, a list to search. The Status list's "Only failed requests" row is gone: `4xx` and `5xx` are two boxes in sight.
→ Not done, of what Vercel's Logs draws: the count beside a value (the API has none, D5), monospaced rows at 26px, the volume strip over the list, and a panel that leaves the top bar free.

### D45 · Events lists sign-ins, and tells a login flow as one — 2026-11-12
Amends D30. One sign-in wrote about ten loose rows, which nothing in the list tied together, an actor that changed within it, and an abandoned attempt that looked like a real sign-in. Vercel groups by what its server already knows, never by the rows a page happens to hold: Logs chooses Runtime Logs or Request Logs ("logs grouped by request"), Traces chooses Spans or Traces, a selected unit opens its parts in a pane, and Group By exists only for metrics. Events follows it. A **Sign-ins** view joins the view picker: one row per sign-in, read as the events a sign-in ends in (`session.established` and the failure types), each one range of the type index, so pages fill and no sign-in is cut at a page's edge. A row says how it ended, whose account (by name) and its session; an Outcome filter replaces the category and the type there. A `session.established` without a user is an anonymous session the type index cannot tell apart, and says "Session opened". The drawer heads a login flow with what it came to ("Signed up with single sign-on", failed, abandoned or in progress, only when it holds the whole flow), its user, start and duration, and places each step on a track by its time since the first, as a trace's waterfall does. In the flat views, the open event's login flow (or else its request) is marked among the loaded rows, and an `auth.attempt.created` whose flow neither handed off, nor gave a session, nor was refused within an attempt's lifetime (15 minutes) reads Abandoned, under no filter but the view and a start of the time. The drawer calls a flow failed only once its attempt has expired; until then a refused step is still in progress. Users are named by what they are called now, read once per user; events keep IDs. Not done: the method and duration on a list row (the outcome event does not carry them), and one actor per sign-in, which is the server's actor rule (events-for-people decision 4).

### D44 · The bar names where you are: the platform, or the platform and a project — 2026-11-12 · [standing]
Amends D27, D38, D39 and D42, supersedes D36, and resolves D42's open naming of the root. A UX pass on the preview found one place with two names: choosing the platform said All projects in the bar over its own Users, Login flows and Events, which read as a view across every project, and the switcher listed it among the recent projects with no check. Going up to Projects from a project left the pill naming that project over the root's list, whose rows open the platform's screens. Vercel's bar says All Projects at a team because its team screens add up every project; the platform's are its own, so the copy misled. The bar is now a path from the root down, as Vercel's runs from team to project: at the root the pill reads Platform, for someone who may act on it, and All projects for anyone else, whose root holds only their projects; in a project it reads `Platform / fabis-app ▾`, the root a link to Projects. Projects, Settings and the profile are the root's, and hold the root as the selection: the platform project for someone who may act on it, nothing for anyone else. So going up drops the project left behind, which D36 kept in the URL unnamed, where it still ranked search's matches (D39) and left Projects reachable under two selections that looked alike. The way back is the pill's Recent. The console sets it on every link up and the signed-in guard enforces it for any URL; a project is selected only by choosing one. The pill's list offers Platform in a section of its own above Recent and Projects, checks the row the pill stands for, and never lists the platform as a recent project, also not one a browser kept from before. Its footer still opens All projects, the list. Choosing Platform keeps a list screen the root has and otherwise opens Projects, since the root has no Overview.
Search names the root as the bar does: its rows read Platform for someone who may act on it, and Account for anyone else, whose root holds their projects, Settings and profile, and for whom "All projects" would not name where Profile is.
→ One name for a customer's root in the bar and in search, All projects or Account, waits on accounts (Console ADR 0005 §4).
→ Design review of the bar: the root's glyph, and whether the root crumb should open a menu of its own once accounts matter (Console ADR 0005 §4).

### D43 · Events narrows to what happened to a user — 2026-11-11
Amends D30, whose filters named who did something (Actor) and what it was done to (Resource). A sign-in has no actor until it ends, and its checks, its session and its token are records of their own, so neither filter found what happened to one person's account. Events now has a User filter: `user:` in the search, "Only this user" on a row and in the panel, `user_id` in the CSV. It lists the events that concern the user, whoever acted, a rejected password included. A pasted `user_…` ID asks which is meant, what happened to its account or what it did, as another ID asks actor or resource; the account's reading holds the changes to the user too, so the resource is not offered a third time. The rows and the Actor column are unchanged.
→ The rows themselves, a sentence each with names for the IDs, are open in [events-for-people.md](api/events-for-people.md#7-in-the-console).

### D42 · The platform project is the root: a project's screens, for the people who own the platform — 2026-11-11 · [standing]
Amends D27, D29, D37, D39 and D40, and supersedes D34. An operator administers every project (root [ADR 075](../adrs/075-platform-operators.md)), so the reserved platform project the console signs into showed in Projects, the switcher and search as a project named Platform, chosen like a customer's. It is not one of the projects: it is the root, and the projects are the spine beneath it. It is still a project, with a project's resources and a project's configuration, so its screens are a project's own, under the same names. What differs is where they are and who sees them: they are the root's, it is never a project to choose, and they are only for someone who may act on it. It manages who may use the platform (the console, the CLI, later MCP clients) and never an application's end users. It stays a control project, not a super-project ([ADR 053](../adrs/053-cross-project-principals.md) §9): an operator always may act on it and a cloud customer, who holds no grant there, never can. Signing in to it or being homed in it shows nothing.
The root's sidebar is the root's: Projects, then the platform project's screens (Teams, Users, User schemas, Login flows, Branding, Deployments, Authentication, Events), then Settings. Each is the project's screen drawn for the platform project, which its row selects (`?project=` names it), so no screen is copied and one a project gains, such as Apps, is the root's too. Overview is left out, since the root's home is Projects. The platform project's own Settings pages, General and Admins, head the root's Settings list (D29), before what the hosted cloud adds (Billing, Support, Email). Its teams are the accounts that own projects, and its Admins are who administers the platform; operators are not listed there, since they hold it through the server's configuration (ADR 075 §4). This replaces D34, whose root listed a project's screens and asked for a project. Someone who cannot act on the platform project sees Projects and Settings, and a URL that selects it goes on in their own project, as for any project they cannot choose.
While one of its screens is open the pill says the root, All projects, never a project named Platform, and the switcher's list and its recent projects never hold it. Events' list and the Settings list lead back to Projects from there. The way from a root screen into a project is the pill's list or Projects: the platform project is the selection while its screen is open, so D36's kept selection covers Projects and Settings only.
Writing its configuration is for its admins, and the server holds that, not the console. On the reserved project every write of configuration (an origin, a release, a deployment or its rollback, a preview, a variable, a schema, a flow definition, a policy, branding, an identity provider, an application) asks for the admin role, on top of the editor role the operation asks on any project (Console ADR 0004 §1). An operator holds it (ADR 075). The reason is who its users are: every one of them is an account of the console, which can be granted any project (ADR 053 §2), gets a team at sign-up (ADR 046 §4) and can claim, so an origin added carelessly turns an application's end users into accounts of the platform. What says who may use the platform (its users, teams, grants, invitations) is written as on any project.
The server marks the reserved project in `GET /console/runtime.json` as `platform_project_id`. It is present only when the console signs in to the project bootstrap provisioned, and the console compares ids against it, never against a written id. The pin and the first-created fallback never set it, so a self-hoster's only project stays a project to choose, with the relations every project asks (Console ADR 0004 §2). `listMyProjects` takes `exclude_platform`, which Projects, the switcher, search's project rows and the `_authed` guard's default selection send: an operator with one customer project lands in it. Without the parameter the list is unchanged (ADR 075 §6), so the CLI still lists it.
Search lists the root's screens with what is above every project, reading Account as Projects does, beside the selected project's. What it finds in the platform project ([ADR 087](../adrs/087-search.md) §6) reads as the root's screen that lists it (Users, Teams, User schemas, Login flows, Authentication), and opening one selects the platform project, as opening any hit selects its project.
→ Governance is the platform's own next page: policies, and what projects are allowed to do. Nothing describes it yet, and it needs an ADR.
→ Single sign-on for an account's staff is the account's own, a connection of its team ([ADR 081](../adrs/081-customer-hosted-login-and-oidc-provider.md)), the same feature a customer's tenants get, not a setting of the platform. Whether a tenant may configure anything is open in [ADR 066](../adrs/066-operation-policies.md) (Policy hierarchy).
→ The root lists its screens for anyone who can read the platform project. Someone granted editor or viewer there reads its configuration and is refused on writing it. Listing by role waits for a read of effective permissions (Console ADR 0004 §5).
→ Deploying to the platform project from a folder, as [ADR 084](../adrs/084-hosted-cloud-business-systems.md) §8.1 wants for the hosted cloud's sign-up terms, needs a credential an admin holds: it has no project secret (ADR 053 §9), and the CLI's platform login (ADR 053 §5) is not built.
→ Each person gets a team at sign-up on the platform, since a project attaches to a team (ADR 046 §4). Creating it when they first own a project, and offering it to any project as an option of sign-up (ADR 084 §8.5), come later. A project with no teams, a B2C service, stays as it is.
→ Sign-up to the platform project is open by default, behind a proof of work only, on a self-hosted server too. Whether that is the right default there is open.
→ Done by D44: the root is Platform in the bar and in search, for someone who may act on it.
→ Add user and Add team at the root create an account outside sign-up. Whether the hosted cloud should offer them is open.
→ Search past ten projects: the platform project is the oldest, so an operator with more than ten finds nothing of it while a customer's project is selected. Searching it beside the newest ten is a change to ADR 087 §6.
→ Operators: a read-only list waits for an operator read under ADR 054 §10.
→ The schema has no root: the platform project is the `projects` row with the built-in id, and configuration names it to the server. A marker column written by bootstrap belongs with Console ADR 0004 §2's cutover.
→ Design review of the root's sidebar, which is long for someone who administers the platform, and of Profile at `/account`.

### D41 · Configuration and resources share one detail layout — 2026-11-11 · [standing]
Supersedes the look half of D0a. Login flows, identity providers and releases draw the same detail screen as users, teams and project settings: a header, then body cards of labelled rows on one 218px label rail, 16px either side of the rule between rows and no rule after the last, labels in medium weight, inputs and a section's aside starting on the rail. Configuration still differs in what it allows (D0b), not in how it looks. The header is the title over one line of identity values, 16px apart, and the body starts 36px under it. Only resources (projects, teams, users, releases) lead the title with an icon tile. A user's email is the line's first value, unlabelled. A value with nothing behind it yet (a project's issuer, a team's primary domain, a user's last sign-in) is left out; the designs keep it for later. An identity provider keeps a link to its list above the title (amends D13): that list is a tab of Authentication, so the sidebar alone does not lead back to it.
→ Designs follow the shared layout.

### D40 · A project's Settings opens its own list, as the root Settings do — 2026-11-11 · [standing]
Amends D35, whose project Settings was one page with General and Admins tabs. On Projects, Settings carried an arrow and swapped the sidebar for its own list (D29); in a project, a row of the same name and glyph opened a page beside the project's screens. As Vercel's team and project Settings both do, a project's Settings now opens a list too: General (the project's name, origins, variables and policies), then Admins, under a heading that leads back to the project. Both pages keep the project's header (its name, ID and created date). The root Settings are the platform project's (Profile, and on the hosted cloud Billing, Support and Email), so the two lists hold different pages; only the way they open is shared. Search lists a project's Settings pages among its pages, marked Settings and the project.
→ Design review of the pages without tabs: Admins' heading row with its Add button.

Amended (#2855, #2857): the Admins page is Members, with a Members tab listing every person and team with a role on the project and an Invitations tab.

### D39 · Above every project, search finds what is in the person's projects — 2026-11-10, amended 2026-11-11 · [standing]
Amends D37, which with no project selected found only pages, projects and the account, so "admin" answered "Nothing matches" for an administrator. The palette now asks the server's search without a project at All projects, and on Projects and Settings even while a project stays selected there (D36): those screens are above every project, as the switcher's list there is. The server reads the projects the person can act on, the newest ten of them ([ADR 087](../adrs/087-search.md) §6). Inside a project the palette searches that project alone. Users, teams and configuration of those projects rank with the rest, the selected project's first among equal matches, each with its project's name beneath, after its own second line, or the project's ID for one the palette has not listed. Opening one selects its project (`?project=`) and lands on it there; it is then a recent item of that project (D33). Across projects it asks once per pause in typing, for every type, so the server lists and checks the projects once; inside a project it asks for users apart, so the other kinds do not wait for them. Once the server has answered it says what it searched: users, teams and configuration, or only teams and configuration for text too short to match users by, in every project the person can act on or in the newest ten of them, and then choosing a project searches the others. That last line stays beneath the matches too. When a kind has more matches than the server read, or a grant that covers part of a project saw none of the rows read, a line beneath the list says more may match and to type more. "See all users matching" stays a project's: its list is one project's Users.
→ Searching every project from Projects and Settings while one is selected is a product call (2026-11-11) that may be reversed.

### D38 · The events screen is named Events — 2026-11-11
Amends D30, which named the screen Logs for now, as in Vercel. Every other surface already says events: `GET /events`, `zitadel event list`, the route, the API reference and the event webhooks, which deliver these same events. And "logs" already names something else: `zitadel logs` prints the local server's output, and a self-hosted server writes logs of its own, which root ADR 048 keeps apart from events. The sidebar row, the list's heading and Overview's link now read Events; the views keep their names (Audit events, API requests, All), and nothing else about the screen changes.

### D37 · Search ranks every kind in one list, and says where each is — 2026-11-10 · [standing]
Amends D32, which grouped what the palette found by kind and named the selected project only in its pages' heading. Side by side with Vercel's Find: there one list of a handful of rows puts the best match first, the current project's before the team's (`Logs · cloud` above `Logs · zitadel`), and says beneath every row where it is. Ours put a page of the project and a project of that name in two groups (Branding, test-branding), named no project on a user's row, listed two projects of one name alike, and said "Nothing matches" without saying it had looked in one project, or in none. Once something is typed the palette is now one list of at most eight rows, ranked by how the name matches (whole, start, a word's start, inside), or the second line the server matched it on (a user's identifier), then the selected project's before what is above it, then pages, actions, users, teams, configuration, projects and the account; with no project selected its pages come after the projects, since one opens only once a project is chosen. Beneath each: the project, after a hit's own second line; a project's host or else its ID (D21); Settings for its pages and Account for the account's other rows; and "Choose a project" for a project's page while none is selected (D22). With nothing found it names the project it searched, or says one is needed, and until the server has answered it says "Searching…" instead. Before anything is typed it stays a menu in groups (D33), its Projects opening as the switcher does: the selected and recent ones, then the rest by name while one page holds them all, and past one page the first of them, so it never opens on none.
→ Done by D39: search across projects.

### D35 · A project lands on its Overview — 2026-11-10
Amends D20, whose landing (`/`) was Users. As in Vercel, where the team sidebar's Projects row is Overview inside a project, a project's sidebar now starts with Overview, the project's own page, and `/` opens it: after sign-in, from the logo of a project, from Logs' heading and when a project is chosen with no screen asked for. With no project chosen and several to choose from, `/` is still Projects itself, not "Continue to Overview" (D22). The page is the project's name, its site and its ID, then what its primary origins serve now (the live release, when and why it went live, the origins serving it, and Deployments), then its newest five audit events (each opening, and Logs). It holds no figures: the API has no counts or aggregates (D5), which is what dropped the earlier stat-card design. Each card reads on its own and says so when its read fails. The account list leaves Overview out: Projects stands in its slot (D34). Settings' first tab becomes General, as Vercel's is, so a project has one Overview.
→ Design review of the page: the header, the Production card and the activity rows, none of which has a frame.

### D34 · Projects lists the project's screens too — 2026-11-10
Amends D27, whose account sidebar was Projects and one Settings row (D29): on the console's home that left the sidebar nearly empty. As Vercel's team sidebar does, it now lists Projects, then the project's screens (Teams to Logs), then Settings. The pill there names no project, so a project's screen chosen from this list asks for one (D31), even when the URL still carries the project the person came from, as Vercel's team-level Analytics asks right after leaving a project; its row is the marked one while it asks (D22), and with one project there is nothing to ask. The project's own Settings is left out: up here Settings is the account's, as Vercel's team Settings is the team's, and two rows of one name would be two places.
→ Design review of the account sidebar's length and order.

### D33 · Search runs actions and remembers what it opened — 2026-11-10 · [standing]
A palette that only finds things leaves the commonest next step, adding one, a page away. With a project selected it now lists Actions under the project's pages: Add user and Add team open the drawers their lists open (D15), over the screen the person is on, and land on what was created; Copy project ID puts the id on the clipboard and says so. An action shows as its list's Add button does, whatever the person may do: the console has no permissions read yet, and the server refuses what is not allowed. Before anything is typed the palette opens on Recent, the last five things opened from it in that project. They are kept in memory for the session only, because a row carries an end user's name and identifier, which do not belong in the browser's storage.
→ Gate actions on effective permissions when the console can read them (Console ADR 0004 §5).

### D32 · Search finds users and configuration, through the server's search — 2026-11-10 · [standing]
The palette found pages, teams and projects, each through a request of its own, and no user, because the Users list had no text to search by. It now asks the server's search ([ADR 087](../adrs/087-search.md)) for what the selected project holds: users by the start of their identifier or of their given or family name, teams by name, and configuration (user schemas, login flows, identity providers) by what they are called, or any of them by an id pasted into the field. Users, Teams and Configuration are groups between the project's pages and Projects. A row shows the server's title, and on the right its second line (a user's identifier beside their name), or the project where there is none. The palette stays navigation, not a results page: it lists the best five of each kind, and when there are more users a last row opens the Users list on the same text. Users are asked for from three characters and apart from the rest, so neither answer waits for the other. The Users list that the last row opens searches identifiers only, so a person found by name is not on it.
→ Actions and recent items in the palette; search across projects once the API offers it.

### D31 · A screen that needs a project asks for it with a picker — 2026-11-10
Amends D22, which sent such a screen to Projects and only renamed that list "Continue to Teams". The list carried what the question does not need: each project's ID, its created date, its row menu and the title row's action. As in Vercel, the step is now a centred block (shadcn's Empty): the screen's icon, "Continue to Teams", "Choose a project to continue.", then the search and the projects, each as the project switcher draws it (its mark, its name, and its site's host or else its ID beneath, D21), and New project at the end. It is still Projects with `?next=`: the same read, newest first (D28), the same server-side search and Load more (D5). Opened for itself, Projects stays the list of D21 and D27. With no project yet there is none to choose from, so the page is the first project's command, as before.
→ Design review of the picker: the block's place on the page, the row, and New project in the list.

### D30 · Logs lists the project's events — 2026-11-10
A project's sidebar gains Logs, after Authentication and before Settings: the project's events, newest first (`GET /events`), each with its type, what it was about (an API request's method, operation and status, or the record a change touched), who caused it and when, to the second. A row opens the event: its values, the events related to it, and the event as the API returns it. The name is Logs for now, as in Vercel, where the entry holds every kind of log: API requests are best-effort records, which "Audit log" would overpromise, and "Events" reads as webhooks. The API, the CLI and the route keep `events`.
As Vercel's Logs does, and as Settings does here (D29), opening Logs swaps the sidebar's list for Logs' own, headed by its name beside a chevron, a row that leads back up to the project's screens (D13). The pill still names the project, since Logs is inside it. The list's rows are the views: Audit events, the default, are the sign-ins and changes; API requests, one per call, have a view of their own, since every screen that is opened adds some; All reads both. Under the views sit the filters: Timeline (the last hour, 24 hours or 7 days, or everything retained), Category, and a field each for a type, an actor, a resource, a request, a session and a login flow. A field matches one whole value, typed or pasted, applies it on Enter and clears it in place. No filter lists values or counts them: the API has neither.
Above the table, a search field takes one ID or one event type and sets the filter it names; an event's ID opens the event. It is not a text search and says so. An ID that may be an actor or a resource offers both and waits for the choice, since guessing would show an empty list for the other reading. A row's menu ("Only this …") and Related events on the event's page set the same filters from an event.
Any filters combine: the server bounds every read (root ADR 048, amendment of 2026-11-10), so Logs refuses no combination. A view, a category, a type, a request or a login flow on its own, and an actor, a resource or a session with or without a category, are each one range of an index and always fill their pages. Any other combination is matched event by event over a fixed number of events a request, so a page can come back short, or empty, with more behind it. The list then says that not every event has been read yet, its empty state reads "No events have matched so far" in place of "No events match these filters", and the button reads `Keep looking` in place of `Load more`; one click is one request, and nothing follows on its own. Two filters still give way, for what they mean: a type names its own category, so it reads the All view with no category beside it, and choosing a category or another view drops it; the API requests are one category, so their view takes no other. An actor and a resource narrow the view and the category they are set in; a request, a session and a login flow read All, since a request's own event is not an audit event. The time range narrows all of them; it is counted back once, when the list loads, and `Load more` keeps it.
While the sidebar is an icon rail, on a phone or collapsed, the rail keeps the views as icons and has no room for the filters. A button beside the search then names the view and how many filters are set, and opens the sidebar, over the page on a phone. No total count (D5).
→ Design review of Logs' list in the sidebar (its heading row and filter fields), the search, the list's columns and the event page, none of which has a design.

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
Identity: the identifier stays in the User cell (no Identifier column, D20), under the display name when there is one. Hovering the user opens an identity card: schema, what they sign in with, display name, memberships, lifecycle owner and created date. Chosen over bringing the Identifier column back, which repeats the identifier whenever a schema designates no display name. Amended (#2605): no chip names the identifier's property (`email`, `username`), in the cell or the card, and the card carries no line on what `x-identifier` and `x-display` decide: the card is about the user, and schema mechanics belong to the schema's documentation.
Teams: the column is "Member of", since it lists memberships; a `pending` or `inactive` membership carries a tag. The team that owns a user's lifecycle is a different relation (ADR 024) and shows in the identity card, not the column.
→ Design review of the Columns menu, the Attributes cell and its popover, and the identity card.

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

Amended (#2733): the User schemas name column shows the name as text, without the resource icon.

### D16 · Profile is generated from the person's own schema; the identifier is read-only — 2026-09-30, amended 2026-10-16 · [standing]
Claiming asks for nothing but an email address, and the identifier cannot be changed, so the schema's `x-identifier` (the email by default) is a disabled field. Amended: Profile is generated from the person's own user schema as Add user is — every property is a row; strings and numbers are editable and saved through `PATCH /users/me`, anything a text input cannot round-trip (a boolean) is read-only. The platform project's schema adds an optional `name` designated as `x-display`, so the people operating Zitadel can name themselves; the account menu offers it while none is set.

### D15 · Create uses a right-side drawer — 2026-07-31 · [standing]
Adding a resource (e.g. a user) opens a drawer from the right — the shadcn/ui default interaction pattern. Fields relevant to the current context (e.g. team) are preselected.

### D14 · Schema attributes shown as a simple list — 2026-07-31
On the schema detail, list the pre-populated attributes as a flat, scannable list — not an accordion or a left-nav list (schema setup will get complex, so keep the detail page roomy rather than nesting). If a schema's attribute list gets long, reuse the user-list pattern: search bar + horizontal scroll + "Load more." Rows open the detail on click (shadcn/ui list-item standard).

### D13 · No back buttons or breadcrumbs (console-wide) — 2026-07-31 · [standing, amended by D41]
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

### D0a · Resources vs. schemas are different page patterns — 2026-07-23 · [superseded in part by D41]
Users/teams/projects are resources; schemas are configuration, not resources — they should look different (superseded by D41: the detail screens share one layout). MVP permissions: account creator = owner; invited users get admin; evolve later.

---

<!-- New decision: copy this, bump the ID.

### D16 · <decision> — YYYY-MM-DD
<one line on why>
→ <next step, who>

-->
