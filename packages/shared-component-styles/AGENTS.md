# Agent Instructions — `packages/shared-component-styles`

Optional **surface CSS** for components that exist as both a Lit atom and a paired
React implementation. Values always come from `@zitadel-nextgen/design-tokens`;
this package owns **rules** (selectors, states, layout) once.

## Layout

```
src/
  <id>.css           # shared look — `.zr-*` classes on the painted element
  lit/<id>-host.css  # Lit-only: :host, slots, shadow boundaries
  styles.css         # barrel @import of surfaces only (not lit hosts)
pairs.json           # registry of paired components (docs / tooling)
```

## Rules

- **Only paired components** get a surface file. See `pairs.json`.
- **Never add tokens here.** Missing variables → `design-tokens`.
- **Lit atoms** import surface + host CSS with `?inline` (see
  `packages/components/src/atoms/*.ts`). `@tsdown/css` inlines the strings when
  `components` is built; Vite handles the same in dev and vitest.
- **Paired React components** import `@zitadel-nextgen/shared-component-styles/styles.css`
  once, or the per-component CSS export.
- **Class names are public API** (`.zr-btn`, `.zr-field__wrap`, …). Lit inner
  nodes and React DOM must use the same classes.

## When you change visuals

1. Edit the surface CSS in this package (one place).
2. Adjust `lit/*-host.css` only if the change is shadow-only (slots, `:host`).
3. Run parity checks: `apps/console-e2e` + components unit tests.
