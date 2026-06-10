# @zitadel/ui-react

## 0.1.0-alpha.0

### Minor Changes

- [#116](https://github.com/zitadel/nextgen/pull/116) [`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba) Thanks [@bastionstack](https://github.com/bastionstack)! - Introduce the design-token-driven foundation for the auth surface, replacing
  the demo styling baseline:
  - New `@zitadel/design-tokens` package — the single producer of the
    `--zl-*` CSS variable layer, the typed `tokens` / `cssVars` constants,
    and the Tailwind v4 `@theme` block. Backed by a version-pinned
    `figma-tokens.lock`, a Figma REST sync script, and a manual-trigger
    GitHub workflow that opens PRs with regenerated outputs. A snapshot
    test locks the public token surface.
  - New `@zitadel/ui-react` package — visually identical paired React components
    of every Lit atom (`<Button>`, `<TextField>`, `<Alert>`, `<Pill>`,
    `<Icon>`, `<Card>`, `<PageShell>`). Used by the internal Zitadel console
    and ships a single `styles.css` that consumes the design-token variables.
  - `@zitadel/components`:
    - Drop the legacy `<zl-submit>`, `<zl-action>`, `<zl-error>` atoms and
      the hand-rolled `src/tokens/` catalogue.
    - Add `<zl-button>` (full Figma matrix, form-associated), `<zl-alert>`,
      `<zl-pill>`, `<zl-icon>`, `<zl-card>`, `<zl-page-shell>`. Rebuild
      `<zl-field>` against the Figma Text Field spec.
    - Add `passkey-upsell` and `signed-in` Liquid templates and rewrite the
      default + auth-form templates to compose `<zl-page-shell>` →
      `<zl-card>` with the new atoms.
    - Rewrite `branding-to-tokens` to fan branding palette/density/radius
      onto the new `--zl-*` namespace and add `branding.attribution` for
      "Secured with Zitadel" footer control. Default theme switches from
      light to dark to match the published Figma variable mode.

### Patch Changes

- Updated dependencies [[`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba)]:
  - @zitadel/design-tokens@0.1.0-alpha.0
