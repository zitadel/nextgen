---
"@zitadel/components": minor
---

Add the first publishable surface of `@zitadel/components`:

- The Lit-based atom substrate (`<zl-field>`, `<zl-submit>`, `<zl-action>`, `<zl-error>`) with manifests, parts, slots and the `zl-input` / `zl-submit` / `zl-action` CustomEvents that the orchestrator listens for.
- A `--zl-*` token catalogue, base shadow-host styles and a focus-ring helper consumed by all atoms.
- The `<zitadel-login>` orchestrator: open Shadow DOM, branding-to-tokens via `adoptedStyleSheets` (light/dark), pluggable `FlowTransport` (`FetchTransport`, `FixtureTransport`), DOMPurify allowlist for `zl-*`, font-url loader, branding shape validator, and a LiquidJS engine with banned `| raw`, the `| t` filter and the `{% mandatory_gates %}` patcher.
- Bundled `default.liquid` + `auth_form.liquid` partials for centered and split layouts, plus an `en` locale stub.
- Subpath exports for `./atoms`, `./manifests`, `./tokens`, `./orchestrator` and `./orchestrator/transport`.
