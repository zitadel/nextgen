# ADR 056: Login Customization Categories and Ownership

> **Status:** Proposed
> **Date:** 2026-08-27
> **Context:** Where each kind of login customization is authored, stored, and
> applied across embedded login (customer application) and hosted login
> (Zitadel-served page for SSO).
> **Long form:** [`../design/branding/customization-strategy.md`](../design/branding/customization-strategy.md)
> **Relates to:** [ADR 040](040-tenant-login-templates-editable-config.md)
> (amends §5: page-layout catalog leaves Liquid),
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
| **Page chrome** | The document around `<zitadel-login>` |
| **Widget appearance** | `--zl-*` tokens / structured branding knobs / page-local element props |
| **Widget structure** | The Liquid template (`login.liquid`) |
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

### 3. Page chrome is not a branding field

**Embedded.** Page chrome is application code wrapping
`<zitadel-login variant="widget">`. The CLI may scaffold page templates as
ordinary framework files; they are presentation-owned (ADR 042).

**Hosted.** Page chrome is a platform page-template setting plus constrained
content slots (markdown, image URL, later allowlisted HTML). The hosted
shell renders the wrapper; the widget stays `variant="widget"` inside the
form pane.

Page chrome is not stored on the branding revision for embedders. Promoting
arbitrary host HTML into branding is either too weak (sandboxed) or too
dangerous (executed on hosted requests). Hosted slots are a constrained
equivalent of the wrapper, not a serialization of the customer's app.

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

**Hosted login.** Page templates exist **only** here: Console settings the
hosted shell reads. Same catalog *names* as the CLI wrappers are fine;
the artifact is hosted-shell config, never Liquid. Embedders do not get
this panel.

Already-ejected split/hero revisions keep rendering. This decision
retires them as the setup path, not as a runtime.

### 6. Hosted login does not get a second renderer or branding model

Turning on hosted SSO reuses categories 2–5. The only new choice is
category 1 (pick a hosted page template). Atom eject and hand-composed
atoms remain embedded-only: there is no customer repo on the hosted path.

## Consequences

- Product and Console can place a control by asking "which category?"
  rather than inventing a new store.
- The "content on the left" story is unblocked without weakening the
  Liquid sandbox: it is a wrapper (now) or a hosted slot (later).
- Embedders keep a no-publish path (host CSS / element props) so matching
  an app design system stays a local edit.
- Hosted login work is scoped: ship page-template settings and Console
  knobs that write the existing branding resource; do not fork the widget.
- Setup guidance should point at the generated auth file for page chrome
  and at `.zitadel/` for schema, flow, and appearance knobs. Structure
  (`login.liquid`) appears only after an opt-in eject.
- Follow-ups land as implementation: page-template scaffolds instead of
  `--design` Liquid, move `.zl-split` / `.zl-hero` CSS out of the
  orchestrator, hosted-only page-template settings, optional `minimal`
  chrome knob. Already-ejected revisions stay valid.

## Rejected alternatives

- **Put the split-with-content-left story in Liquid.** Arbitrary customer
  HTML inside the template either bypasses the sanitiser or cannot express
  a real application pane. Page chrome is the document; the template is
  the atoms.
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
- **Offer hosted page-template settings to embedders.** They have an
  application. That setting exists only because hosted login does not.

## See also

- [`../design/branding/customization-strategy.md`](../design/branding/customization-strategy.md)
- [`../design/branding/templates.md`](../design/branding/templates.md)
- [`../design/branding/override-ladder.md`](../design/branding/override-ladder.md)
- [`../design/platform/README.md`](../design/platform/README.md) —
  integration levels (embedded MVP, hosted login deferred)
