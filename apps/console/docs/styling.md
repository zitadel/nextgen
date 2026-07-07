# Console styling

How we style the console. Read this before adding a component or a CSS rule.

## TL;DR

- **Design tokens are the source of truth.** `@zitadel/design-tokens` owns every
  colour, spacing step, radius, font, etc.
- **Tailwind is the convenience layer, not a parallel design system.** The token
  package generates a Tailwind `@theme` from the tokens, so the tokens show up as
  utilities (e.g. `bg-zl-surface-default-black`). Using a `zl-*` utility and using
  the underlying CSS variable are the same value.
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

## Token utilities

The token `@theme` (`@zitadel/design-tokens/css/tailwind.css`) exposes these
namespaces. **Always use these for design-meaningful properties — never raw hex,
and never Tailwind's default colour palette (`bg-gray-800`, etc.).**

| Token namespace      | Example variable                       | Example utility                         |
| -------------------- | -------------------------------------- | --------------------------------------- |
| Colour (surface)     | `--zl-color-surface-default-black`     | `bg-zl-surface-default-black`           |
| Colour (text)        | `--zl-color-text-secondary-gray`       | `text-zl-text-secondary-gray`           |
| Colour (border)      | `--zl-color-border-default-gray-100`   | `border-zl-border-default-gray-100`     |
| Radius               | `--zl-radius-m`                         | `rounded-zl-m`                          |
| Font family          | `--zl-font-family-sans`                 | `font-zl-sans`                          |

For **layout spacing** (`p-*`, `gap-*`, `w-*`, flex/grid), use Tailwind's default
numeric scale — it is finer-grained and idiomatic. Spacing is layout glue, not a
brand decision, so it does not need a token. (Token spacing utilities such as
`p-zl-04` exist if you want to pin to the scale, but they are not required.)

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
