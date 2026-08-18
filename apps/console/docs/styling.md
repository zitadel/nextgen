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

## Component resolution (design → code)

**Inventory before building.** List every component a design uses and find where
each one comes from, before writing markup. Skipping this is how you end up with
several hand-rolled copies of a component the library already defines.

Work from the design's **component names**, not from what the screenshot looks
like — the names are the component identities. Map the full screen frame
(sidebar + main), not a content crop.

Resolve each name to a source, in this order:

1. Already in `src/components/ui/`? Use it.
2. In the shadcn registry? **Check before writing anything.** `combobox`, `field`,
   `input-group`, `alert` and `command` all exist.
3. Neither? Add it to `src/components/ui/` — once, shared. Never inline a
   library component inside a feature file.

**Mind which shadcn track a registry item belongs to.** `components.json` pins
`"style": "new-york"`, so the reference is `registry/new-york-v4/**` (Radix). The
registry also ships a newer track built on `@base-ui/react`, and the CLI will
install it without comment — pulling a second headless library alongside the
Radix components already here. `Combobox` is exactly this case: for `new-york` it
is the documented `Popover` + `Command` composition, which is what
`src/components/ui/combobox.tsx` implements. Adopting the Base UI track is a
deliberate, separate decision, not a side effect of a ticket.

### Specs come from the design system, not from screen mocks

Read geometry from the design-system library, not from a component instance placed
on a screen mock. Mock instances *are* library instances, so their resting
geometry is correct — which makes them convincing while hiding:

- the state matrix (hover, focus, **invalid**, disabled)
- size variants
- optional slots (leading icons, inline addons)
- appearance variants

Screen mocks are also not always internally consistent — the Add-user drawer wires
`Select`-shaped triggers to `Combobox` menus. Build from the component the design
*means*, and record which one you used.

`Select` = one option, no search. `Combobox` = searchable, with a single and a
multiple type. "Pick one, but searchable" is a Combobox — Radix `Select` offers
typeahead only, not filtering.

### Verify

Check computed values against the spec, not just a screenshot, and confirm both
themes and each breakpoint the design defines in a real browser. Leave dev
overlays visible for at least one click-through: the TanStack devtools badge sits
bottom-right, exactly where right-anchored sheets put their primary action.

Canonical examples:

| Region | Component |
| --- | --- |
| Nav chrome | `Sidebar` (`collapsible="icon"`; mobile = persistent icon rail) |
| Org/project picker | `Popover` + `Badge` |
| Users filters | `Tabs` |
| Users table | `Table`, `Avatar`, `Badge`, `DropdownMenu`, `Button` |
| Panel around a screen's content | `Card` |
| Attribute chip / CLI command in prose | `InlineCode` |
| Any searchable picker | `Combobox` (`src/components/ui/combobox.tsx`) |
| Field with a leading icon or inline addon | `InputGroup` (`src/components/ui/input-group.tsx`) |
| Labelled form control | `Field` + `FieldLabel` (+ `FieldError` for invalid) |

## Resource list layout — one shell for every list screen

Every list frame draws the same shell, and each screen had grown its own version
of it: different page gutters, different cell padding, and a header label wrapped
in a ghost-button-shaped span on one screen but not the others. The shared
geometry now lives in `src/components/resource-list.tsx` — compose it rather than
restating the numbers per screen.

**The page shell applies to every list screen; the table geometry only to those
that are tables.** User schemas is a `Card` of rows rather than a table (D0a —
resources and schemas are different page patterns; D7 — the list stays small
enough not to need a dense one), so it takes `RESOURCE_PAGE` and
`RESOURCE_HEADER` and nothing else.

| Region | Value |
| --- | --- |
| Page gutter | 16px — the same inset as the table |
| Header gutter | 24px — the page gutter plus 8px |
| Table head | 56px tall, 24px leading / 16px trailing inset |
| Table cell | 56px tall, 24px inset, 8px block padding |
| Head label | display face, 12/16, 0.72px tracking, `foreground` |
| Row icon | 16px, stroke 1.5, `muted-foreground`, 10px to its label |

Two things are deliberately **not** shared, because the designs genuinely differ:

- **Column widths.** Teams sits on a fixed 248px grid, Projects on thirds, and
  the Users table is schema-driven and scrolls horizontally, so it has no fixed
  grid to share.
- **Vertical rhythm above the table.** Each frame places its own header block, so
  the page's top padding and the table's top margin stay with the screen.

Where a design reserves a trailing column for a row menu, keep the column even if
the menu is not built — dropping it re-spreads every other column and moves them
off the design's grid.

Two values here look like something they are not, and a pixel diff is what caught
both: the head label is `foreground`, not the `muted-foreground` it resembles at a
glance; and the design's Lucide glyphs are drawn at **stroke 1.5**, where
`lucide-react` defaults to 2 — a glyph at the default weight reads heavier than
the design even though its box measures correctly.

## Traps that have already cost time

- **A registry default is not our design system.** `components/ui/*` arrives from
  the shadcn registry with the registry's own values, and where ours differ the
  fix belongs in that file, once — not re-applied per screen. `Input` is the case
  that kept coming back: stock shadcn is `bg-transparent`, so a field takes on
  whatever surface it sits on. On the page that happens to look right; on a
  `Card` — every detail screen — it reads as the card and looks wrong. Our design
  fills an input with `background`, a surface of its own. If a control looks
  wrong on one screen and right on another, suspect an inherited surface and fix
  the component, not the screen.
- **A flex row will shave text by a pixel rather than wrap it.** A value in a
  `min-w-0` flex row shrinks below its natural width, and `truncate` then clips
  it. When the shortfall is smaller than an ellipsis glyph no ellipsis renders,
  so it reads as a missing character — a typo in an id, not truncation.
  Negative `tracking` makes the intrinsic width borderline enough for this to
  land on exactly one glyph. Identifiers get `shrink-0` and set their own
  container's width; the row wraps when there is no room.
- **Bare `border` is `currentColor`.** Tailwind v4 Preflight sets it, so a
  registry component writing `border-l` draws a near-white edge in dark mode. The
  base rule in `styles.css` points unqualified borders at the border token — and
  it **must** stay inside `@layer base`, or it out-ranks every `border-input` /
  `border-foreground/10` utility.
- **Variant specificity.** `Button`'s `has-[>svg]:px-3` out-specifies a plain
  `pl-*`/`pr-*`; use the `!` suffix or size the parent. When an override "won't
  take", suspect specificity, not a typo.
- **`asChild` needs prop forwarding.** `PopoverTrigger asChild` clones its child
  and injects `onClick`/ref/`data-state`. A custom trigger that does not spread
  rest props onto its root element is inert.
- **cmdk auto-highlights its first item** on mount, painting a filled row the
  design never shows. Gate the fill on real interaction.
- **Do not add a focus ring to an auto-focused input.** cmdk focuses the search
  field whenever the popover opens, so the ring would be permanently on — a state,
  not an affordance.
- **Error copy belongs to the API.** ADR 030 makes the payload's `message` the
  human-facing string; render it verbatim. Read it from the response **body** —
  `ApiError.message` is a transport string (`POST /users returned 409`).

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
