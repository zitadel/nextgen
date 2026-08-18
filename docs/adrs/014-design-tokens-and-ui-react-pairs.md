# ADR 014: Design tokens and paired React components for the auth surface

> **Status:** Superseded by [ADR 052](./052-lit-only-login-surface.md) — 2026-05-19

> The token half of this ADR still holds: `@zitadel/design-tokens` remains the
> only producer of `--zl-*`, and the console still embeds `<zitadel-login>`
> rather than wrapping it with `@lit/react`. What ADR 052 removes is the paired
> React implementation of each atom, now that the console composes shadcn/ui.

## Context

The Zitadel NextGen auth surface ships as two parallel renderers:

1. **`@zitadel/components`** — Lit web components plus the
   `<zitadel-login>` orchestrator. Embedded by tenants on their own pages
   and by the demo SDK adapters.
2. **`apps/console`** — the internal Zitadel console, a pure React app
   that needs the same visual primitives without the Lit runtime.

Both surfaces are driven by the Figma file
[`Zitadel - Design System - External`](https://www.figma.com/design/8UjCXw8yemgljmbkWGrSfE/Zitadel---Design-System---External).
The four target screens for the first release are Sign In, Sign Up,
Passkey upsell, and Signed In.

We needed to answer three coupled questions:

1. Where do design tokens live, and how do code and Figma stay in sync?
2. How do Lit and React render the same visuals?
3. How does the console pick up the Lit orchestrator without dragging
   in a Lit adapter?

## Decision

### 1. A standalone `@zitadel/design-tokens` package

The package is the only producer of `--zl-*` CSS variables, the typed
`tokens` / `cssVars` constants, and the Tailwind v4 `@theme` block:

```
@zitadel/design-tokens
├── figma-tokens.lock              # pinned Figma library version
├── scripts/sync-from-figma.ts     # Figma REST API → figma.tokens.json
├── scripts/build.ts               # JSON + overrides → CSS/TS/Tailwind
└── src/
    ├── overrides.ts               # tokens not exposed by Figma yet
    ├── generated/tokens.css
    ├── generated/tokens.ts
    └── generated/tailwind.css
```

The lockfile, sync script, and generator are wrapped by a manual-trigger
GitHub workflow that opens a PR with the regenerated files. A snapshot
test in `tokens.snapshot.spec.ts` locks the public token surface so a
designer renaming a variable can't ship silently.

We deliberately did **not** adopt Style Dictionary or Token Studio: the
amount of state to manage was small, and we wanted full control of the
JSON → output shape (especially the Tailwind namespace mapping) for a
clean Lit + React story.

### 2. Lit atoms and paired React components, both consuming the same tokens

Two thin layers:

- **Lit atoms** in `packages/components/src/atoms/` consume tokens via the
  `t` wrapper in `packages/components/src/styles/tokens.ts`, which
  `unsafeCSS`-wraps the `cssVars` tree so atom CSS can write
  `background: ${t.color.surface.defaultBlack};`.
- **Paired React components** in `packages/ui-react/src/` are pure React.
  They reach the same tokens via CSS variables in
  `packages/ui-react/src/styles.css` (e.g. `.zr-btn--primary { background:
  var(--zl-color-surface-default-white); }`).

We did not use `@lit/react` for the React side — the goal is a console
that ships zero Lit runtime.

> **Update (2026-06):** Lit ↔ React parity and the orchestrator showcase
> moved to the unified Storybook (`apps/storybook`), where stories run as
> real-browser tests via `@storybook/addon-vitest` (in CI). The original
> `apps/console-e2e/visual-parity.spec.ts` matrix sweep was retired with the
> playgrounds.

### 3. Console embeds the Lit orchestrator via a tiny `createElement` wrapper

> **Update (2026-06):** Superseded. The console no longer hosts the
> orchestrator — it is being built into the real settings app. The
> `<zitadel-login>` end-to-end showcase now lives in the `Orchestrator/Login`
> Storybook stories (MSW via `msw-storybook-addon`), and the framework demos
> (`apps/demo-next`, `apps/demo-nuxt`) remain the real-SDK integrations. The
> original decision is kept below for context.

The console is the only React surface that hosts the actual
`<zitadel-login>` orchestrator (so reviewers can see the end-to-end
flow). It does so through a 12-line `React.createElement("zitadel-login",
…)` wrapper, not `@lit/react`. This keeps the dependency story honest:
the console depends on `@zitadel/components` (the Lit element
package) for the orchestrator side effect, on `@zitadel/ui-react`
for chrome and previews, and on `@zitadel/design-tokens` for the
shared variable layer.

### 4. Branding attribution is a first-class branding flag

`Branding.attribution` (new in this PR) toggles the "Secured with
Zitadel" pill rendered by the orchestrator footer. Tenants can suppress
it entirely (paid licence) or swap it for a `custom_link`. The
attribution chip itself is a `<zl-pill>` so the visual treatment matches
the rest of the chrome.

### 5. Dark is the primary mode; light ships alongside it

**Amended 2026-07-25 — the original decision ("dark is the only mode for
v1") is superseded.** Both modes now carry real values: the legacy
semantic tokens in `src/legacy.tokens.json` are authored as
`{ dark, light }` pairs, and `scripts/build.ts` emits the light halves
into the `[data-theme="light"]` block of `tokens.css`. Light values
mirror the position each token occupies on the (dark-first) gray ramp —
`gray.50` is the darkest shade and `gray.900` the lightest — so light
mode is a systematic reflection of the published scale rather than a
second, hand-tuned palette. Accent tints step to their deeper shades
(`purple.300` → `purple.600`) because a tint chosen for legibility on a
dark surface has too little contrast on a light one.

Dark remains the **primary** surface: it is what the hosted login and
`variant="page"` render when nobody states a preference. Resolution
precedence, strongest first: the element's `theme` property →
`branding.theme.mode` → a variant-derived default (`dark` for `page`,
`auto` for `widget`, so an embedded widget follows the visitor's
`prefers-color-scheme` instead of forcing dark onto a light host page).

Naming caveat: the legacy token names encode their dark-mode appearance
(`--zl-color-text-primary-white` resolves to a near-black in light mode).
The names are a frozen public surface — see `MIGRATION.md`; the shadcn
namespace (`--zl-foreground`) is the mode-neutral successor.

## Consequences

- One source of truth for visuals across Lit and React; both
  packages own their own CSS but read the same variables.
- Designers can rename or restructure tokens; the snapshot test catches
  it before the sync PR merges.
- Tenants can't ship custom React without consuming
  `@zitadel/ui-react`; that's a deliberate constraint to keep
  the visual contract stable.
- The console gives up the `@lit/react` typed-prop ergonomics; that's
  fine — the `createElement` wrapper is one line per attribute and the
  orchestrator's properties are accessed via `ref`.

## Related work

- [`packages/design-tokens/README.md`](../../packages/design-tokens/README.md)
- [`packages/ui-react/README.md`](../../packages/ui-react/README.md)
- [`packages/components/README.md`](../../packages/components/README.md)
- [`.github/workflows/sync-design-tokens.yml`](../../.github/workflows/sync-design-tokens.yml)
