# Console styling

How we style the console. Read this before adding a component or a CSS rule.

## TL;DR

- **Design tokens are the source of truth.** `@zitadel/design-tokens` owns every
  colour, spacing step, radius, font, etc.
- **Tailwind is the convenience layer, not a parallel design system.** The token
  package generates a Tailwind `@theme` from the tokens, so the tokens show up as
  utilities (e.g. `bg-zl-surface-base`, `text-zl-text-primary`). Using a `zl-*`
  utility and using the underlying CSS variable are the same value.
- **Theme-aware by default.** Semantic tokens flip between dark and light via
  `data-theme` on `<html>`; write components against semantic tokens and they
  re-theme for free (see [Theming](#theming-dark--light)).
- **The styling approach is decided by *where the component lives*, not by a
  prediction about future reuse:**
  - Anything under **`apps/console/**` → Tailwind utilities.**
  - The shared design-system primitives (`packages/components` + `packages/ui-react`,
    styled via **`@zitadel/shared-component-styles`) → token CSS, not utilities.**
- `src/styles.css` holds only the Tailwind entry, the token imports, and global
  page theming. It must not grow component-scoped class rules.

## Which styling approach do I use?

Answer one question — **where does this file live?** — and you're done:

```
Where does the component live?
├── apps/console/**  (the console app: shell, pages, layout, app widgets)
│     → Tailwind utilities, colours via the zl-* theme.
│       Do NOT author a bespoke CSS file or add rules to styles.css.
│
└── packages/components + packages/ui-react  (shared design-system primitives,
    e.g. Button, Card, TextField — each has a Lit + React twin)
      → style in @zitadel/shared-component-styles, keyed to --zl-* variables.
        Utilities live in JSX className and cannot reach a custom element's
        shadow DOM, so they are not an option for these.
```

You almost never hit a fork inside the console: the console doesn't emit web
components, so everything authored here is React-only and uses utilities. The
only adjacent question is the *architectural* one — "should this be a shared
primitive instead of a console-local component?" — which is decided on reuse and
review, not styling. If a console component is later promoted to a shared
primitive, you move it into the package and convert its styling **then**; don't
pre-build for a web-component twin that may never exist.

> Why the split exists (it's a constraint, not a preference): a design-system
> primitive is **two implementations of one atom** — a Lit element (`zl-button`)
> and a React component (`Button`) — that must render identically. They do that
> by sharing a single stylesheet (`@zitadel/shared-component-styles`): the Lit
> twin pulls it into its shadow DOM, the React twin renders the same `zr-*`
> classes in light DOM. Styling the React twin with Tailwind utilities would fork
> it from its Lit twin. App composition has no twin, so utilities are free.

## Where components live

There are two homes, and that is the whole decision:

| Component kind | Lives in | Styling |
| --- | --- | --- |
| Design-system **atom** (paired Lit + React twin: `Button`, `Card`, `Alert`, `Pill`, `Icon`, `Select`, `TextField`, `Checkbox`, …) | `packages/components` (Lit) + `packages/ui-react` (React) | shared `zr-*` CSS in `@zitadel/shared-component-styles` |
| **Everything else** — console organisms/molecules and any reusable React piece (`AppShell`, `PageHeader`, `DataTable`, `KeyValueTable`, `boundaries`, …) | `apps/console/src/components` (cross-route) or co-located with the route (route-specific) | Tailwind utilities |

There is deliberately **no third "shared React component" package**. We have no
other React app on the horizon, so a React component that several console routes
share simply lives in `apps/console/src/components`. If a genuine second consumer
ever appears, extracting a package is a later, explicit step — don't pre-build
for it.

Default to building in `apps/console`. You only leave it when the login /
web-component surface needs the *same* primitive, which makes it a paired atom in
the design-system packages.

> **The paired atoms are not theme-portable yet.** Every pair's surface CSS in
> `packages/shared-component-styles/src/*.css` still uses the **legacy dark-only
> login tokens** (`--zl-color-surface-default-*`, `--zl-color-text-button-*`,
> `--zl-color-gray-*`), which don't flip with `data-theme` (login is dark-only
> for v1, ADR-014 §5). Composing one into the light/dark console renders the
> login treatment in both themes — wrong in light. So until those stylesheets
> migrate to the current semantic taxonomy, **build console screens
> console-local even where a pair nominally exists** (e.g. a button, a select),
> using theme-flipping `zl-*` utilities, and swap to the pair after it migrates.
> `Icon` is the exception: it renders a glyph with `currentColor` and is
> theme-safe, so compose it freely.

## Token utilities

The token `@theme` (`@zitadel/design-tokens/css/tailwind.css`) exposes these
namespaces. **Always use these for design-meaningful properties — never raw hex,
and never Tailwind's default colour palette (`bg-gray-800`, etc.).**

The console uses the **current Figma taxonomy** (theme-aware surface/text/border
plus accent/status). The legacy `*-default-black` / `*-primary-white` tokens
still exist for the login component but should not be used in new console code.

| Token namespace      | Example variable            | Example utility            |
| -------------------- | --------------------------- | -------------------------- |
| Surface              | `--zl-color-surface-base`   | `bg-zl-surface-base`       |
| Surface (raised)     | `--zl-color-surface-raised` | `bg-zl-surface-raised`     |
| Surface (hover/fill) | `--zl-color-surface-subtle` | `bg-zl-surface-subtle`     |
| Text                 | `--zl-color-text-primary`   | `text-zl-text-primary`     |
| Text (muted)         | `--zl-color-text-secondary` / `--zl-color-text-tertiary` | `text-zl-text-secondary` |
| Border               | `--zl-color-border-subtle` / `--zl-color-border-default` | `border-zl-border-subtle` |
| Accent               | `--zl-color-accent-subtle-dark` | `bg-zl-accent-subtle-dark` |
| Status               | `--zl-color-status-positive` | `text-zl-status-positive` |
| Radius               | `--zl-radius-m`             | `rounded-zl-m`             |
| Font family          | `--zl-font-family-sans`     | `font-zl-sans`             |

For **layout spacing** (`p-*`, `gap-*`, `w-*`, flex/grid), use Tailwind's default
numeric scale — it is finer-grained and idiomatic. Spacing is layout glue, not a
brand decision, so it does not need a token. (Token spacing utilities such as
`p-zl-04` exist if you want to pin to the scale, but they are not required.)

## Theming (dark / light)

The console re-themes via `data-theme` on `<html>`. The tokens ship a dark
`:root` and a light `[data-theme="light"]` override, so **using the semantic
utilities above is all you need — do not branch on the theme in component code.**

- Default is the OS `prefers-color-scheme`; the context-bar toggle sets an
  explicit Light / Dark / System preference, persisted in `localStorage`
  (`src/theme.ts`).
- `index.html` applies the resolved theme before paint to avoid a flash.
- Only reference *semantic* tokens (`surface-*`, `text-*`, `border-*`). A raw
  primitive like `bg-zl-color-gray-900` won't flip between themes.

## Layout: the 12-column grid

Page content uses the Figma 12-column grid, exposed as the design-system
`layout/*` tokens (`--zl-layout-columns`, `--zl-layout-gutter`,
`--zl-layout-margin`). Use the primitives in `src/components/layout.tsx`:

- `<Page>` — centres content and applies the horizontal margin + vertical rhythm.
  Every routed page renders inside one (the shell's `<main>` is padding-free).
- `<ContentGrid>` — a responsive grid whose gutter is `--zl-layout-gutter`. It is
  a single column below `md` and 12 columns (the `layout/columns` value) at `md`
  and up; children place themselves with standard `col-span-*` utilities
  (e.g. `md:col-span-6 lg:col-span-3` for a 4-up stat row). The column count is
  `grid-cols-12` rather than the token because CSS forbids a `var()` as the
  `repeat()` count.

## Responsive breakpoints

Mobile-first: default classes target small screens, `md:` and up target desktop.
The shell sidebar is off-canvas below `md` (48rem), a 264px rail at `md`+, and
collapses to a 72px icon rail via the sidebar toggle. Breakpoints match the
`--zl-breakpoint-*` tokens.

## Conventions

- **Long / repeated utility strings → a named `const`** in the same module, e.g.
  the table cell styles in `src/components/resource-page.tsx`. Keep the full class
  string as a literal so Tailwind's scanner still sees it; do not build class
  names by concatenating fragments at runtime.
- **Stateful / structural selectors → arbitrary variants**, not a CSS file. The
  off-canvas sidebar uses `group/shell` + `group-data-[nav-open=true]/shell:…`
  (see `src/components/app-shell/AppShell.tsx`), and the table "no border on the
  last row" rule uses `[&_tbody_tr:last-child_td]:border-0`.
- **Reuse layout primitives** instead of re-hand-rolling markup. `PageHeader`,
  `DataTable`, `KeyValueTable`, and `TableLink` in `resource-page.tsx` are the
  shared, utility-styled building blocks for resource pages.
- **Responsive:** mobile-first. Default classes target small screens; add `md:`
  for ≥ desktop. `md` is 48rem, matching `--zl-breakpoint-md`.

## What not to do

- Do not add component-scoped class rules to `styles.css`.
- Do not use raw hex colours or Tailwind's stock palette — go through `zl-*`.
- Do not reach for shared CSS / a new stylesheet for a React-only component.
- Do not try to style a dual-target primitive with utilities — it has a web
  component twin that cannot consume them.
