# ADR 045: Copy Overlays as Branding Revisions

> **Status:** Proposed
> **Date:** 2026-08-02
> **Context:** The widgets' locale dictionaries and copy overlays (`businessLocales`), the branding-revision resource (ADR 040 / the templates track), and the CLI scaffold templates.
> **Relates to:** [ADR 040](040-tenant-login-templates-editable-config.md)

## Context

The widgets ship neutral built-in copy, and audience-flavored wording is an
overlay: `businessLocales` lives in `@zitadel/components`, is re-exported
through the framework SDKs, and is wired into generated pages at scaffold
time when the project chose the business use case. This works, but the
mechanism has a shape problem:

- The overlay is **branding-shaped data living in code**. Changing wording
  means a package release and an app redeploy, while the platform already
  has a home for exactly this kind of data — immutable, per-project branding
  revisions resolved at flow time (ADR 040).
- Every framework SDK must re-export the overlay and every scaffold template
  must wire it, multiplying one dictionary into eight integration points
  (the cross-framework parity work now in flight does precisely this
  multiplication).
- The overlay applies per **app build**, not per project or environment —
  two apps on one project can disagree about the project's own voice.

## Decision (proposed)

Copy overlays become part of the **branding revision** resource:

- A branding revision carries optional per-language copy entries
  (key → string over the built-in dictionary keys, same shape as today's
  `locales` property values). The server resolves the project's current
  revision and delivers the merged copy with the flow response; the widgets
  apply it exactly as they apply a `locales` property today (element-level
  `locales` remains as the app-level override with higher precedence).
- `setup --use-case business` seeds a branding revision carrying the
  business overlay instead of wiring template props — the generated pages
  stay copy-agnostic, and every framework gets the overlay through the same
  server path with zero per-SDK wiring.
- Copy edits follow the branding lifecycle: eject → edit → apply publishes a
  new revision (ADR 040's model), making wording changes runtime-effective
  without app redeploys and giving them revision history.

The bundle keeps only the neutral built-ins; `businessLocales` remains
exported as a convenience preset for hand-integrators, but the scaffold and
platform path no longer depend on it.

## Consequences

- One source of truth for copy across all eight framework scaffolds; the
  per-SDK re-exports and template wiring become a transitional mechanism to
  retire once this lands.
- Copy joins branding's governance story (revisions, environments per
  ADR 035/040) instead of being a build-time constant.
- The flow response grows a copy payload; the widgets' locale resolution
  gains one precedence layer (element property > revision copy > built-ins).

## Fence

Implementation is deliberately fenced behind the templates-track milestone:
this ADR seeks direction alignment only, and no code should be built ahead
of acceptance (the built-ahead-of-alignment pattern is how parallel work has
rotted before). The interim per-SDK wiring keeps delivering value until then.
