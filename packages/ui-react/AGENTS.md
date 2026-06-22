# Agent Instructions — `packages/ui-react`

Paired React implementations of the Lit atoms. The Lit atoms in
[`packages/components/src/atoms/`](../components/src/atoms) are the behavioural
source of truth; **visual rules for paired components live in**
[`packages/shared-component-styles`](../shared-component-styles).

## Layout

```
packages/shared-component-styles/src/<id>.css   # single source for paired look
packages/ui-react/src/<atom>.tsx                # React DOM + behaviour only
packages/ui-react/src/styles.css                # @import shared barrel
```

## Hard rules

- **No Lit runtime.** Never reach for `@lit/react`. Pairs must be plain React.
- **No duplicate surface CSS.** Edit `shared-component-styles`, not `ui-react`
  CSS files (there are none per atom — only `styles.css` imports shared).
- **No new tokens.** All visual values come from
  [`@zitadel/design-tokens`](../design-tokens/README.md).
- **Class names are part of the public API** (`.zr-*`). Must match Lit inner DOM.
- **One `<atom>.tsx` per atom.** `<Alert>` may use `<Icon>`; no bigger graphs.
- **Unpaired components** stay local to their package when we add React-only or Lit-only UI.

## Local checks

```sh
moon run ui-react:build
moon run ui-react:typecheck
```
