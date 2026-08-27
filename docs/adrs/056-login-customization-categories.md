# ADR 056: Login Customization Categories and Ownership

> **Status:** Proposed
> **Date:** 2026-08-27
> **Context:** Where each kind of login customization is authored, stored, and
> applied across embedded login (customer application) and hosted login
> (Zitadel-served page for SSO).
> **Long form:** [`../design/branding/customization-strategy.md`](../design/branding/customization-strategy.md)
> **Relates to:** [ADR 040](040-tenant-login-templates-editable-config.md)
> (amends §5: page-layout catalog is not a widget-template catalog),
> [ADR 044](044-scaffold-embedding-posture-defaults.md),
> [ADR 045](045-copy-overlays-as-branding-revisions.md),
> [ADR 018](018-widget-owned-locale-resolution.md),
> [ADR 035](035-configuration-environments.md),
> [ADR 042](042-scaffolded-file-ownership-and-drift-detection.md)

## Context

Nextgen ships `<zitadel-login>` for customers to embed in their own
application (CLI-bootstrapped) and will later offer the same widget as a
hosted login for SSO. The product goal is total customizability. Without an
ownership map, three different changes — a 1:1 split page with marketing on
the left, rounder buttons, a disclaimer between atoms — collapse into one
"template" or one settings screen, and the hosted path has nowhere to put
page-level content that embedders write as application code.

Existing decisions already cover pieces: branding revisions and the design
catalog (ADR 040), `page` vs `widget` posture (ADR 044), copy overlays
(ADR 045), host-page token precedence (the branding override ladder), and
locale on the element (ADR 018). They do not say which *kind* of
customization belongs on which surface, or how that mapping changes when
Zitadel owns the page.

## Decision

### 1. Five categories, one home each

| Category | Home |
| --- | --- |
| **Page chrome** | Embedder: app wrapper. Hosted: **page template** (`page.liquid`) |
| **Widget appearance** | `--zl-*` / structured branding / element `appearance` |
| **Widget structure** | The **widget template** (`login.liquid`) — both deployments, strict scope |
| **Voice** | Branding copy overlays; element `lang` / `locales` as the page override |
| **Behavior** | The flow definition — never an appearance editor |

A split layout whose left pane is *customer content* is page chrome. A
disclaimer between the password field and submit is widget structure.
Button radius is widget appearance. Those must not share an authoring
artifact.

### 2. Login placement is orthogonal to Zitadel runtime

**Embedded** (customer application; ships now) and **hosted** (Zitadel-served
page; later, SSO) differ in who owns the HTML document. Cloud vs
customer-operated Zitadel server is a different axis and does not move a
knob between categories.

Both placements render the same `<zitadel-login>` against the same project
branding revision.

### 3. "Page template" is hosted-only; "template" is shared and strict

The paired names are the point. A **widget template** (`login.liquid`) is
widget structure: `<zl-*>` against the step payload, no page chrome.
Because the same widget runs in the customer app and on hosted login,
that file must stay strict and apply to **both** deployments.

A **page template** (`page.liquid`) exists only because hosted login has
no application to wrap. It is a Liquid document with a required
`{% login_widget %}` hole; the rest is the customer's page (split, left
pane, nav) under the same sanitiser family. `{% login_widget %}` is
opaque — page templates do not emit atoms; widget templates do not emit
a marketing column.

**Embedded.** Page chrome is application code wrapping
`<zitadel-login variant="widget">` (ADR 042). The CLI may scaffold a
wrapper. That file is not a page template.

**Hosted.** The shell renders `page.liquid` and injects the widget at
`{% login_widget %}`. Embedders never author this file.

### 4. Project look travels on the branding revision; page-local look stays on the element

Widget appearance, widget structure, and project voice are project-scoped
and live on the branding revision (ADR 040 / 045). Embedders *may* also set
host CSS and element properties (`theme`, `variant`, `lang`, `locales`) for
the current page; those win over server branding and do not require
`apply`. Hosted login has no host design system, so it consumes the
revision as-is and exposes the same knobs as Console settings.

Do not add a second appearance vocabulary on the element that duplicates
`branding.json`. New typed element sugar must map onto `--zl-*` / the
branding shape.

### 5. Page-layout "designs" leave Liquid; setup writes a wrapper

An audit of the five shipped files
(`packages/config/defaults/branding/*/login.liquid`) is in the
[strategy doc](../design/branding/customization-strategy.md#what-the-shipped-designs-really-are):
`centered` is the bundled default; `split` / `split-right` / `hero` are
page chrome around a copy-pasted card; `minimal` is card-less widget
chrome. They are not five widget structures.

**Embedders.** The CLI keeps a setup look-picker. That picker scaffolds
application files (a wrapper around `<zitadel-login variant="widget">`).
It does not write `login.liquid` and does not publish a branding revision.
`branding eject` remains the opt-in for *structure* and starts from the
bundled default card, not from a catalog of page layouts.

**Hosted login.** Page templates exist **only** here: `page.liquid` with
`{% login_widget %}`. Same catalog *names* as the CLI wrappers are fine;
the artifact is not `login.liquid`. Embedders do not get this editor.

Already-ejected split/hero revisions keep rendering. This decision
retires them as the setup path, not as a runtime.

### 6. Hosted login does not get a second renderer or branding model

Turning on hosted SSO reuses categories 2–5. The only new choice is
category 1 (pick a hosted page template). Atom eject and hand-composed
atoms remain embedded-only: there is no customer repo on the hosted path.

## Consequences

- Product and Console can place a control by asking "which category?"
  rather than inventing a new store.
- The "content on the left" story is unblocked without loosening the
  shared template: embedders wrap in the app; hosted login uses a page
  template. The widget template stays strict for both.
- Embedders keep a no-publish path (host CSS / element props) so matching
  an app design system stays a local edit.
- Hosted login work is scoped: ship page-template settings and Console
  knobs that write the existing branding resource; do not fork the widget.
- Setup guidance should point at the generated auth file for page chrome
  and at `.zitadel/` for schema, flow, and appearance knobs. Structure
  (`login.liquid`) appears only after an opt-in eject.
- Follow-ups land as implementation: setup scaffolds app wrappers instead
  of `--design` Liquid; hosted `page.liquid` + `{% login_widget %}`;
  element `appearance`; move `.zl-split` / `.zl-hero` CSS out of the
  orchestrator; `chrome: card | plain`. Already-ejected revisions stay
  valid.

## Rejected alternatives

- **Put the split-with-content-left story in the (widget) template.**
  That file is shared. Page chrome in `login.liquid` would land on every
  embed. Hosted page chrome is a *page* template; embedder page chrome
  is the app.
- **One settings blob for every visual change.** Page chrome, tokens, and
  atom order have different authors, publish paths, and trust boundaries.
- **Hosted login as a separately themed app.** Doubles the branding model
  and forces restyling when a customer turns on SSO.
- **Require `apply` for every appearance tweak.** Embedders matching a
  host design system would take a config release to change a radius.
- **Keep split/hero as Liquid so embedders can skip a wrapper.** Those
  files are wrappers. The CLI already writes the auth page; writing a
  real one is cheaper than a five-way template fork and a sanitiser
  around marketing copy (`hero` already invites that).
- **Offer page templates to embedders.** They have an application. The
  name exists because hosted login does not.

## See also

- [`../design/branding/customization-strategy.md`](../design/branding/customization-strategy.md)
- [`../design/branding/templates.md`](../design/branding/templates.md)
- [`../design/branding/override-ladder.md`](../design/branding/override-ladder.md)
- [`../design/platform/README.md`](../design/platform/README.md) —
  integration levels (embedded MVP, hosted login deferred)
