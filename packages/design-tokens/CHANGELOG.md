# @zitadel/design-tokens

## 0.1.0-alpha.1

### Patch Changes

- [#727](https://github.com/zitadel/nextgen/pull/727) [`04704fb`](https://github.com/zitadel/nextgen/commit/04704fb1a019aa3041aa37f8c9f23dbc27d4fee3) Thanks [@github-actions](https://github.com/apps/github-actions)! - Declare what each Figma collection is, and surface every one the designer
  pushes.

  `sync-from-export` inferred a collection's role from its shape: "the Light/Dark
  one is the semantic colour surface, anything else multi-mode is viewport
  typography". Once Figma shipped `Syntax` and `Gradient Colors` — both Light/Dark,
  neither semantic — that put two collections in one bucket keyed only by mode
  name, and the later-sorting file replaced the earlier one outright.
  `Gradient Colors` resolved, was counted in `resolvedLeaves`, and then left the
  pipeline without a trace.
  - Roles now come from `src/collections.ts`, keyed by Figma collection name:
    `semantic` | `themed` | `viewport` | `primitives` | `registry-only`. An export
    the manifest doesn't name stops the sync, as does a manifest entry whose
    collection no longer exists — so adding or renaming a collection in Figma is a
    decision someone makes rather than one the resolver guesses. Within a role,
    two collections landing on the same key throws instead of overwriting.
  - `themed` collections are emitted as `--zl-syntax-*` and `--zl-gradient-*` with
    `[data-theme="light"]` overrides, plus Tailwind aliases (`text-zl-syntax-key`,
    `bg-zl-gradient-red-start`). They stay out of `css/shadcn.css`, which owns the
    unprefixed shadcn contract.
  - Every collection still feeds the alias registry regardless of role, so
    `{brand.purple.500}` resolves even though `brand` surfaces nothing itself.

- [#818](https://github.com/zitadel/nextgen/pull/818) [`310014f`](https://github.com/zitadel/nextgen/commit/310014f1ec8df441b161d12bb01658d27aa1f478) Thanks [@bastionstack](https://github.com/bastionstack)! - `theme="light"` now paints every part of the login surface, not just its resting colours. Hover, pressed and focus states on buttons, fields and selects re-theme with the mode, the card keeps a visible edge, and the attribution pill follows the light palette. Dark mode is unchanged.

  Three semantic tokens carry the interactive states: `--zl-color-surface-hover-strong`, `--zl-color-surface-hover-subtle` and `--zl-color-border-hover`. Surfaces should reach for these rather than the raw `--zl-color-gray-*` ramp, which is mode-independent by design and keeps its dark shade on a light page.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Ship a real light theme. The legacy `--zl-color-*` tokens the auth atoms consume are now authored as `{ dark, light }` pairs and emitted into the `[data-theme="light"]` block, so switching modes actually repaints surfaces, text, borders, icons, and the focus ring — previously that block only carried the shadcn namespace, and light mode resolved correctly while every surface stayed dark. `<zitadel-login>` gains a `theme` property (`light | dark | auto`); resolution runs element property → `branding.theme.mode` → variant default, where a `page` stays dark (the design system's primary surface) and an embedded `widget` follows `prefers-color-scheme` instead of forcing a dark card onto a light host page.

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
