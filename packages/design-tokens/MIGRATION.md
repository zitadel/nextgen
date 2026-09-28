# Token migration: shadcn is the target

The console is being rewritten to a **full shadcn/ui surface** (Figma Vega
`j3qqriDab6WQfrlgLujf4Y`). This package emits the token contract that rewrite
consumes.

## Vocabularies

| # | Vocabulary | Example names | Where | Emitted |
| - | --- | --- | --- | --- |
| 1 | **Legacy login** | `--zl-color-surface-default-black`, `--zl-color-text-button-*`, `--zl-color-gray-*` | `packages/components/src/atoms/*.css` (the Lit atoms; themed light+dark since ADR-014 §5 was amended — names still encode their dark appearance) | yes — frozen in `src/legacy.tokens.json` |
| 2 | **shadcn** (target) | `--zl-background`, `--zl-foreground`, `--zl-primary`, `--zl-card`, … | `apps/console/**` via `css/shadcn.css` | yes — from `figma-export/`, themed light+dark |
| 3 | **Old console semantic** | `--zl-color-surface-base/raised/subtle`, `--zl-color-text-primary/secondary` | retired WIP | **no** — not preserved |

## Console contract (decided)

The console uses the **unprefixed** shadcn utility names (`bg-background`,
`text-muted-foreground`, `border-border`). `src/generated/shadcn.css` maps those
onto `--zl-*` so registry components drop in unchanged (`components.json`
`prefix: ""`). The `--zl-*` namespace remains for shared/login packages that
embed in customer pages.

## What the console consumes

`background` `foreground` `card` `card-foreground` `popover` `popover-foreground`
`primary` `primary-foreground` `secondary` `secondary-foreground` `muted`
`muted-foreground` `accent` `accent-foreground` `destructive`
`destructive-foreground` `border` `input` `ring` `ring-offset` `chart-1..5`
`sidebar` `sidebar-foreground` `sidebar-primary` `sidebar-primary-foreground`
`sidebar-accent` `sidebar-accent-foreground` `sidebar-border` `sidebar-ring`

Light `background` is `#fafafa` (neutral.50); `card` / `popover` stay `#ffffff`
so elevated surfaces contrast against the canvas.

## Legacy → shadcn (for the Lit atoms)

| Legacy | shadcn |
| --- | --- |
| `--zl-color-surface-default-black` | `--zl-background` |
| `--zl-color-surface-default-primary-gray` | `--zl-card` |
| `--zl-color-surface-default-secondary-gray` | `--zl-muted` / `--zl-secondary` |
| `--zl-color-text-primary-white` | `--zl-foreground` |
| `--zl-color-text-secondary-gray` | `--zl-muted-foreground` |
| `--zl-color-text-error` / `--zl-color-icon-error` | `--zl-destructive` |
| `--zl-color-border-default-gray-*` | `--zl-border` / `--zl-input` |
| `--zl-color-surface-hover-strong` / `--zl-color-surface-hover-subtle` / `--zl-color-border-hover` | `--zl-accent` |
| `--zl-color-gray-*` (raw ramp) | no 1:1 — use a semantic token |

The raw ramp is **mode-independent by design**: a primitive is one shade, and
the semantic tokens above do the light/dark flip by pointing at a different
rung per mode. A surface that reads `--zl-color-gray-*` directly therefore
keeps its dark-mode shade in light mode — which is how every interactive state
came to be unreadable on a light page. Reach for a semantic token; if none
fits, add one rather than the primitive.

### Gaps (shadcn ships no source)

`--zl-color-text-success` / `status-positive` (no success ramp — keep legacy
`#33a779` or add a Figma variable). Interaction states are covered on the
legacy side by the three `hover` tokens above; Figma expresses them as opacity
overlays and publishes no variable, so those entries stay hand-authored in
`legacy.tokens.json` until it does.
