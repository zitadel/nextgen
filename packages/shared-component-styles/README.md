# @zitadel-nextgen/shared-component-styles

Surface CSS shared by **paired** Lit atoms (`@zitadel-nextgen/components`) and
React components (`@zitadel-nextgen/ui-react`). Components that exist on only
one side do not belong here.

## Usage

```ts
import "@zitadel-nextgen/design-tokens/css/tokens.css";
import "@zitadel-nextgen/shared-component-styles/styles.css";
```

Per-component import:

```ts
import "@zitadel-nextgen/shared-component-styles/button.css";
```

Lit atoms import each `*.css?inline` and wrap with `surfaceStyles()` in
`packages/components` (inlined by `@tsdown/css` at build time).

## Registry

See [`pairs.json`](./pairs.json) for the list of paired components.
