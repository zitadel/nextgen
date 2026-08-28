# ADR 057: Login Customization Categories and Ownership

> **Status:** Proposed
> **Date:** 2026-08-28
> **Context:** Where each kind of login customization is authored, stored, and
> applied across the three presentation models in
> [#678](https://github.com/zitadel/nextgen/issues/678). First visual
> milestone: [#936](https://github.com/zitadel/nextgen/issues/936).
> **Long form:** [`../design/branding/customization-strategy.md`](../design/branding/customization-strategy.md)
> **Relates to:** [ADR 040](040-tenant-login-templates-editable-config.md)
> (amends §5: page-layout catalog is not a widget-template catalog),
> [ADR 044](044-scaffold-embedding-posture-defaults.md),
> [ADR 045](045-copy-overlays-as-branding-revisions.md),
> [ADR 018](018-widget-owned-locale-resolution.md),
> [ADR 035](035-configuration-environments.md),
> [ADR 042](042-scaffolded-file-ownership-and-drift-detection.md)

## Context

Nextgen ships `<zitadel-login>` and three presentation choices: customer-
embedded login, Zitadel-served login, and a fully custom frontend. Those
are alternatives, not a required progression from embed to hosted SSO.

Without an ownership map, three different changes — a 1:1 split page with
marketing on the left, rounder buttons, a disclaimer between atoms —
collapse into one "template" or one settings screen. The first visual
iteration (#936) is **branding settings** (appearance) on embedded
components only. Voice is a different setting. Structure,
setup-template apply, and Zitadel-served page chrome must not be
smuggled into that ticket.

Existing decisions already cover pieces: branding revisions and the design
catalog (ADR 040), `page` vs `widget` posture (ADR 044), copy overlays
(ADR 045), host-page token precedence (the branding override ladder), and
locale on the element (ADR 018). They do not say which *kind* of
customization belongs on which surface, or which of those surfaces ship
first.

## Decision

### 1. Five categories, one home each

| Category | Home | Horizon |
| --- | --- | --- |
| **Page chrome** | Embedder: application around the component. Zitadel-served: **unset** | Embedder now; served page chrome later |
| **Widget appearance** | **Branding settings** — `--zl-*` / structured branding / element `appearance` | **First iteration (#936)** |
| **Widget structure** | The **widget template** (`login.liquid`) — embedded and Zitadel-served, strict scope | **Later** |
| **Voice** | **Voice setting** — copy overlays; element `lang` / `locales` as the page override | Separate setting, not #936 |
| **Behavior** | The flow definition — never an appearance editor | Already owned by flows |

A split layout whose left pane is *customer content* is page chrome. A
disclaimer between the password field and submit is widget structure.
Button radius is widget appearance. Those must not share an authoring
artifact.

### 2. Three presentation models; runtime is orthogonal

**Customer-embedded**, **Zitadel-served**, and **fully custom frontend**
are choices ([#678](https://github.com/zitadel/nextgen/issues/678)). Cloud
vs customer-operated Zitadel server is a different axis and does not move
a knob between categories.

Embedded and Zitadel-served render the same `<zitadel-login>`. Where
applicable they reuse branding, copy, flows, and later widget structure.
Fully custom does not render the component.

There is no required journey from embedded to Zitadel-served.

### 3. Widget template is shared structure; page chrome for served login is unset

A **widget template** (`login.liquid`) is advanced widget structure:
`<zl-*>` against the step payload, no page chrome. Because the same
widget runs in the customer app and on Zitadel-served login, that file
must stay strict and apply to **both** of those models when it ships.

It is **not** part of #936 and **not** written by `zitadel setup`.

A **page template** (`page.liquid` + `login_widget` hole) is a **proposed
later** direction for Zitadel-served page chrome only. It is not a
product requirement. The first Zitadel-served milestone is a polished
standalone page plus reused branding and content; advanced page
customisation is a separate capability.

**Embedded.** Page chrome is application code wrapping
`<zitadel-login variant="widget">` (ADR 042). That file is not a Zitadel
template.

### 4. Project look travels on the branding revision; page-local look stays on the element

Widget appearance, later widget structure, and project voice are
project-scoped and live on the branding revision (ADR 040 / 045).
Embedders *may* also set host CSS and element properties (`theme`,
`variant`, `lang`, `locales`) for the current page; those win over server
branding and do not require `apply`. Zitadel-served login has no host
design system, so it consumes the revision as-is and exposes the same
knobs as Console settings.

Do not add a second appearance vocabulary on the element that duplicates
`branding.json`. New typed element sugar must map onto `--zl-*` / the
branding shape.

The first iteration is Console **branding settings** in #936.
Voice is a different setting (copy overlays). CLI-to-Console handoff is
out of #936.

### 5. Setup must not apply a widget template

An audit of the five shipped files
(`packages/config/defaults/branding/*/login.liquid`) is in the
[strategy doc](../design/branding/customization-strategy.md#what-the-shipped-designs-really-are):
`centered` is the bundled default; `split` / `split-right` / `hero` are
page chrome around a copy-pasted card; `minimal` is card-less widget
chrome. They are not five widget structures.

**Setup.** `zitadel setup --design` / the wizard must stop writing
`login.liquid` and must stop publishing branding revision 1. Setup embeds
the maintained component (new app: starting page; existing app: drop-in).
That correction is a follow-up issue under #678, not #936. If a look
picker remains, it writes **application** files only.

**Later structure.** `branding eject` remains the opt-in for *structure*
and starts from the bundled default card, not from a catalog of page
layouts.

Already-ejected split/hero revisions keep rendering. This decision
retires them as the setup path, not as a runtime.

### 6. Zitadel-served login does not get a second renderer or branding model

Choosing Zitadel-served reuses appearance, voice, flows, and later widget
structure where applicable. It does **not** require a page-chrome editor
on the first served ship. Atom eject and hand-composed atoms remain
embedded-only. Fully custom frontend is a third model (APIs), not an
escape hatch at the end of the embed path.

## Consequences

- Product and Console can place a control by asking "which category?" and
  "which horizon?" rather than inventing a new store.
- #936 stays branding settings (appearance) on embedded components.
  Voice is a different setting.
- The widget template stays strict so it can be shared later.
- Embedders keep a no-publish path (host CSS / element props).
- Setup-template apply and widget structure get their own issues.
- Zitadel-served page chrome stays unset until that milestone is defined.
- Already-ejected revisions stay valid.

## Rejected alternatives

- **One golden path from embed to Zitadel-served.** The models are
  choices (#678).
- **Put the first visual milestone on the CLI.** #936 is Console;
  onboarding and CLI-to-Console handoff are out of scope there.
- **Put the split-with-content-left story in the widget template.**
  That file is shared later. Embedder page chrome is the app.
  Zitadel-served page chrome is unset.
- **Treat `page.liquid` as a settled requirement.** First served login
  does not need advanced page customisation.
- **One settings blob for every visual change.** Page chrome, tokens, and
  atom order have different authors, publish paths, and trust boundaries.
- **Zitadel-served login as a separately themed app.** Doubles the
  branding model.
- **Require `apply` for every appearance tweak.** Embedders matching a
  host design system would take a config release to change a radius.
- **Keep split/hero as Liquid so embedders can skip a wrapper.** Those
  files are wrappers.
- **Offer a served page-chrome editor to embedders.** They have an
  application.

## See also

- [#678](https://github.com/zitadel/nextgen/issues/678)
- [#936](https://github.com/zitadel/nextgen/issues/936)
- [`../design/branding/customization-strategy.md`](../design/branding/customization-strategy.md)
- [`../design/branding/templates.md`](../design/branding/templates.md)
- [`../design/branding/override-ladder.md`](../design/branding/override-ladder.md)
- [`../design/platform/README.md`](../design/platform/README.md)
