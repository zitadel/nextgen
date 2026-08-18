# ADR 015: Shared component styles for paired Lit/React components

> **Status:** Superseded by [ADR 052](./052-lit-only-login-surface.md) — 2026-05-20

> With no React pair left to share with, the surface/host split had nothing to
> reconcile: each atom's CSS now lives beside it as
> `packages/components/src/atoms/zl-<atom>.css`.

## Context

ADR 014 introduced paired React components that mirrored Lit atom CSS in
`packages/ui-react`. That duplicated Figma rules in two places (`:host`
selectors vs `.zr-*` classes) and did not scale as the library grows. Not every
Lit component will have a React pair, and vice versa.

## Decision

Add `@zitadel/shared-component-styles`:

- **`src/<id>.css`** — shared surface rules using `.zr-*` classes on the
  painted element (one file per paired component).
- **`src/lit/<id>-host.css`** — Lit-only shadow rules (`:host`, slots).
- **`pairs.json`** — registry of paired components.

Lit atoms import surface + host `.css?inline` and wrap them with
`surfaceStyles()` (`unsafeCSS`). `@tsdown/css` inlines those strings when
`components` is built. React imports `styles.css`, which `@import`s the shared
barrel.

Components not listed in `pairs.json` keep styles in their own package.

## Consequences

- One edit updates look for both renderers when a pair exists.
- No generated TS in this package — CSS files are the source of truth.
- Host apps still import `design-tokens` + `ui-react/styles.css` (or shared
  styles directly).
- ADR 014 remains valid for tokens and paired-component behaviour; surface
  ownership moves to this package.

## Related

- [`packages/shared-component-styles/README.md`](../../packages/shared-component-styles/README.md)
- [ADR 014](./014-design-tokens-and-ui-react-pairs.md)
