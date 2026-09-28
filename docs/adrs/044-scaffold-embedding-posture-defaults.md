# ADR 044: Scaffold Embedding Posture Defaults

> **Status:** Accepted
> **Date:** 2026-08-02 (accepted 2026-08-11)
> **Context:** The `zitadel` CLI's scaffolded auth pages and the `<zitadel-login>`/`<zitadel-session>` `variant` surface contract.
> **Relates to:** [ADR 042](042-scaffolded-file-ownership-and-drift-detection.md)

## Context

The widgets carry a two-value surface contract: `variant="page"` paints the
full-page chrome (viewport height, surface background from design tokens),
`variant="widget"` renders an embeddable card that inherits the host page's
layout. Since the session card went widget-first, every scaffolded page pins
`variant="page"` explicitly, and the generated pages name the widget
alternative in a comment.

That single default fits only half the audience. `setup` already
distinguishes the two cases and records the distinction (`scaffolded_framework`
in the scaffold manifest, ADR 042):

- **Fresh scaffold** — the CLI created the app skeleton. There is no design to
  respect; a full-page auth surface is the strongest start, and the homepage
  already redirects to `/login` on the same reasoning.
- **Pre-existing app** — the app has its own shell, theme, and navigation. A
  generated page that takes over the viewport with token-colored chrome
  fights the host design; the agent-evaluation friction log hit exactly this
  (the demo shop rebuilt the generated pages around the widget surface by
  hand).

## Decision

**Scope: route-based integrations only** — frameworks whose patchers add
route files without owning the app shell (today: Next, Nuxt). The SPA
families (React/Vue/Solid/Svelte/Qwik/Angular) are explicitly out of scope
for the widget posture: their patchers write the app's root component, so on
a pre-existing app there is no preserved shell for a widget to inherit —
setup either conflicts with the existing root or, under `--force`, replaces
it. They keep today's page posture until a non-destructive route/layout
insertion contract exists for their routers (open question below).

Within scope, scaffolded auth and profile pages derive their default posture
from the same hinge the homepage uses:

- Fresh scaffold (`scaffolded_framework: true`) → pages pin
  `variant="page"` — unchanged from today.
- Pre-existing app → pages pin `variant="widget"` inside a minimal,
  layout-neutral wrapper (no forced color scheme, no viewport styling), so
  the card drops into the host app's own layout and theme.

**The chosen posture is recorded in the scaffold manifest** (a
`posture: "page" | "widget"` field beside `scaffolded_framework`), and
`doctor --fix` restores from that record. Absence of a posture record —
every manifest written before this decision, and every manifest-less legacy
scaffold — restores `page`, which is what all earlier scaffolds were; the
widget posture is only ever restored on positive evidence. In both postures
the emitted comment names the other variant, and editing the generated page
remains the sanctioned way to change posture (presentation is user-owned per
ADR 042 — no config knob is introduced).

## Consequences

- Templates branch on `PatchContext.posture`, derived once at setup time
  (`derivePosture`) from `scaffoldedFramework`; the manifest gains the
  posture record, and restoration reads it rather than re-deriving the
  hinge (which a manifest-less legacy scaffold could not answer).
- Nuxt's `app.vue` and `pages/index.vue` become conditional on the fresh
  scaffold, mirroring Next's homepage — a pre-existing app keeps its own
  shell instead of conflicting with (or being overwritten by) the CLI's
  dark app shell.
- The journey matrix needs a pre-existing-app lane (Next, Nuxt) to cover
  the widget posture end to end (today's journeys always scaffold fresh).
- Copy in the generated pages' comments and the scaffold guidance
  describes the emitted posture and names the other one rather than
  assuming full-page.

## Open questions

- A non-destructive route/layout insertion contract for the SPA routers
  (React Router, Vue Router, Angular routes, …) that would make the widget
  posture reachable there without touching the app root — a prerequisite
  for lifting the scope restriction.
- Whether `--preset`-style explicitness is wanted anyway (e.g. a
  `--surface page|widget` override at setup time) or whether editing the
  generated page stays the only override.
- Whether the posture should be recorded per page rather than per scaffold,
  so a later template revision can tell a deliberate user choice from the
  scaffold default.
