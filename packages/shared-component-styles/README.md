# @zitadel/shared-component-styles

Surface CSS shared by **paired** Lit atoms (`@zitadel/components`) and
React components (`@zitadel/ui-react`). Components that exist on only
one side do not belong here.

## Usage

```ts
import "@zitadel/design-tokens/css/tokens.css";
import "@zitadel/shared-component-styles/styles.css";
```

Per-component import:

```ts
import "@zitadel/shared-component-styles/button.css";
```

Lit atoms import each `*.css?inline` and wrap with `surfaceStyles()` in
`packages/components` (inlined by `@tsdown/css` at build time).

## Registry

See [`pairs.json`](./pairs.json) for the list of paired components.
