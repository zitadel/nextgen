# Console styling

How we style the console. Read this before adding a component or a CSS rule.

## TL;DR

- **shadcn/ui is the component library.** Install from the registry into
  `src/components/ui/` (`components.json`). Prefer a real shadcn component over
  hand-rolled markup whenever the Figma design system documents one
  (`ui.shadcn.com` links on every library node).
- **Design tokens are the colour/type/shape source of truth.**
  `@zitadel/design-tokens/css/shadcn.css` maps standard shadcn utility names
  (`bg-background`, `text-muted-foreground`, `rounded-md`, `font-serif`) onto
  `--zl-*` variables. Author against those unprefixed names — components
  re-theme for free via `data-theme` on `<html>`.
- **Tailwind is the convenience layer**, not a parallel design system.
- `src/styles.css` holds only the Tailwind entry, the token/shadcn imports,
  fonts, and global page theming. It must not grow component-scoped class rules.

## Which styling approach do I use?

```
Where does the component live?
├── apps/console/**  (shell, pages, layout, app widgets)
│     → shadcn components + Tailwind utilities (bg-background, …).
│       Do NOT author a bespoke CSS file or add rules to styles.css.
│
└── packages/components + packages/ui-react  (paired Lit + React atoms for login)
      → style in @zitadel/shared-component-styles, keyed to legacy --zl-color-*
        variables. The console rewrite does not compose these for new UI.
```

## Token contract

| Layer | What you write | Resolves to |
| --- | --- | --- |
| Utility | `bg-background`, `text-card-foreground` | `--color-*` from `@theme inline` in `shadcn.css` |
| CSS var | `--zl-background`, `--zl-card` | Generated from `figma-export/` (dark `:root`, light `[data-theme="light"]`) |

Do **not** hardcode hex values. Do **not** reintroduce the retired console
semantic names (`bg-zl-surface-base`, `text-zl-text-primary`, …). Legacy
`--zl-color-*` tokens remain for the login atoms only.

Light canvas is `#fafafa` (`background`); elevated surfaces (`card`, `popover`)
are `#ffffff`. Dark canvas is `#050505`; cards are `#121212`.

## Component resolution (Figma → code)

1. Map the **full screen frame** (sidebar + main), not just a content crop.
2. Resolve each region to a shadcn component + variant via the Design System
   library (`HToNyqKwShDmqVurU7Xbld`), not by inventing markup from a screenshot.
3. Install missing components with the shadcn CLI / MCP; keep them under
   `src/components/ui/`.
4. Verify light + dark with a full-frame pixel diff in a real browser
   (chrome-devtools), matching the Figma screen frame — not a content-only crop.

Canonical examples:

| Region | Component |
| --- | --- |
| Nav chrome | `Sidebar` (`collapsible="icon"`; mobile = persistent icon rail) |
| Org/project picker | `Popover` + `Badge` |
| Users filters | `Tabs` |
| Users table | `Table`, `Avatar`, `Badge`, `DropdownMenu`, `Button` |

## Theming (dark / light)

`data-theme` on `<html>` selects the token mode. Preference is `system` |
`light` | `dark` (`src/theme.ts`, toggle in the context bar). Prefer semantic
tokens over `dark:` utilities so surfaces re-theme automatically.

## Don't

- Don't hand-roll a pill/table/tab/sidebar that shadcn already provides.
- Don't paste CLI-generated HSL blocks into `styles.css` — the token pipeline
  owns colours.
- Don't import `@zitadel/ui-react` atoms into new console UI; migrate remaining
  call sites as screens are rewritten.
