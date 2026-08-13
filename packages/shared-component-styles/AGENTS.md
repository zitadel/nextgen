# Agent Instructions — `packages/shared-component-styles`

Optional **surface CSS** for components that exist as both a Lit atom and a paired
React implementation. Values always come from `@zitadel/design-tokens`;
this package owns **rules** (selectors, states, layout) once.

**Mode-aware tokens only.** Surface CSS must consume the semantic tokens
(`--zl-color-surface-*`, `--zl-color-text-*`, `--zl-color-border-*`), which
flip with `[data-theme="light"]`. Never reach for the raw `--zl-color-gray-*`
ramp — it is mode-independent by design, and using it silently breaks light
mode (the #818 lesson: alert/button/card/pill/select/text-field all had to be
migrated off the ramp onto semantic tokens). If the semantic name you need is
missing, add it as a `{ dark, light }` pair in
`@zitadel/design-tokens/src/legacy.tokens.json`, never a hardcoded value.

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
- **Paired React components** import `@zitadel/shared-component-styles/styles.css`
  once, or the per-component CSS export.
- **Class names are public API** (`.zr-btn`, `.zr-field__wrap`, …). Lit inner
  nodes and React DOM must use the same classes.

## Cross-renderer parity gotcha — inherited text properties

Lit atoms get `baseHostStyles` on their `:host` (font-family, color,
`line-height: 1.5`, `-webkit-font-smoothing: antialiased`, box-sizing), which
slotted/child text inherits. The React pairs have **no** equivalent base — they
inherit those from the host page. So any text that isn't explicitly pinned (e.g.
a card body `<p>`, page-shell heading) renders at the host's default
`line-height`/smoothing in React but at `baseHostStyles` values in Lit, and the
two drift (vertical rhythm, and heavier/darker text on macOS without
antialiasing).

Rule: a surface root that wraps **flowing/slotted text** must pin the inherited
text basics itself (at minimum `line-height: 1.5`) so it doesn't depend on the
host. `.zr-card`, `.zr-page-shell`, and `.zr-select` already do this. Components
that pin `line-height` on every text node (`.zr-alert`, `.zr-btn--*`,
`.zr-field__*`, `.zr-pill`, `.zr-checkbox__label`) don't need it. Font-smoothing
is mirrored once for all text-bearing roots by a grouped rule at the bottom of
`styles.css` (the React equivalent of the `baseHostStyles` `:host` smoothing) —
`.zr-icon` is deliberately excluded since it renders only SVG and `<zl-icon>`
does not use `baseHostStyles`. Add new surface roots to that group.

## Cross-renderer parity gotcha — box-sizing

`baseHostStyles` also sets `:host { box-sizing: border-box }` plus
`*, *::before, *::after { box-sizing: inherit }`, so **every** node inside a Lit
atom's shadow is border-box. The flat React DOM has no host to anchor that, so a
`.zr-*` element that adds padding/border on top of an explicit `height` (or
`width`) silently paints larger — a 40px option row became 56px in React only
because `box-sizing` defaulted to `content-box`.

Rule: a multi-element surface must pin the box model for its **whole subtree**,
not per element. `.zr-select` does this once with
`.zr-select, .zr-select *, …::before, …::after { box-sizing: border-box }` —
the React mirror of `baseHostStyles`. Copy that block (renamed) for any new pair
whose children carry their own height/padding/border.

## Cross-renderer parity gotcha — same-element class color clashes

In Lit, an icon's `.zr-icon` rules live in the icon's **own shadow root**, while
a parent's icon color (e.g. `.zr-alert__icon`) sits on the `<zl-icon>` host in
the parent's shadow — different cascade scopes, no conflict. In React the DOM is
flat: the icon span carries **both** classes (`zr-icon zr-alert__icon`), so two
equal-specificity (`0,1,0`) rules compete and source order decides the winner.

That's why `.zr-icon { color: inherit }` once silently overrode
`.zr-alert__icon`'s red in React only. Don't give base `.zr-*` classes a `color`
they don't need: `color` inherits by default, so a component override on a
co-located class always wins once the base stops competing. If a base class
genuinely must set `color`, wrap it in `:where()` to keep specificity at `0,0,0`.

## When you change visuals

1. Edit the surface CSS in this package (one place).
2. Adjust `lit/*-host.css` only if the change is shadow-only (slots, `:host`).
3. Run parity checks: `apps/storybook` stories (`@storybook/addon-vitest`) +
   components unit tests. Don't eyeball renderer parity — assert it. The
   `Parity` story pattern (`apps/storybook/src/parity.ts` + a third story that
   mounts both renderers) diffs `getComputedStyle` per shared `.zr-*` selector
   and fails the run on drift. It is what caught the two gotchas above; add a
   `Parity` story for every new pair.
