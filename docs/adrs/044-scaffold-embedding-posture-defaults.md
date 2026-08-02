# ADR 044: Scaffold Embedding Posture Defaults

> **Status:** Proposed
> **Date:** 2026-08-02
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

## Decision (proposed)

Scaffolded auth and profile pages derive their default posture from the same
hinge the homepage uses:

- Fresh scaffold (`scaffolded_framework: true`) → pages pin
  `variant="page"` — unchanged from today.
- Pre-existing app → pages pin `variant="widget"` inside a minimal,
  layout-neutral wrapper (no forced color scheme, no viewport styling), so
  the card drops into the host app's own layout and theme.

In both postures the emitted comment names the other variant, and editing the
generated page remains the sanctioned way to change posture (presentation is
user-owned per ADR 042 — no config knob is introduced). `doctor --fix`
regenerates the same posture because the hinge is recorded in the manifest
and restored into the patch context.

## Consequences

- Templates branch on `PatchContext.scaffoldedFramework`, which already
  flows from setup and is restored by doctor; no new state is needed.
- The journey matrix needs a pre-existing-app lane to cover the widget
  posture end to end (today's journeys always scaffold fresh).
- Copy in the generated pages' comments and the scaffold guidance must
  describe both postures rather than assuming full-page.

## Open questions

- Whether `--preset`-style explicitness is wanted anyway (e.g. a
  `--surface page|widget` override at setup time) or whether editing the
  generated page stays the only override.
- Whether the posture should be recorded per page in the scaffold manifest
  so a later template revision can tell a deliberate user choice from the
  scaffold default.
