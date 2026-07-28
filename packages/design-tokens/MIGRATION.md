# Token migration: shadcn is the target

The console is being rewritten to a **full shadcn/ui surface** (Figma Vega
`j3qqriDab6WQfrlgLujf4Y`). This package emits the token contract that rewrite
consumes.

## Vocabularies

| # | Vocabulary | Example names | Where | Emitted |
| - | --- | --- | --- | --- |
| 1 | **Legacy login** | `--zl-color-surface-default-black`, `--zl-color-text-button-*`, `--zl-color-gray-*` | `packages/shared-component-styles/*` (paired Lit+React atoms; themed light+dark since ADR-014 §5 was amended — names still encode their dark appearance) | yes — frozen in `src/legacy.tokens.json` |
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

## Legacy → shadcn (for `shared-component-styles`, a later job)

| Legacy | shadcn |
| --- | --- |
| `--zl-color-surface-default-black` | `--zl-background` |
| `--zl-color-surface-default-primary-gray` | `--zl-card` |
| `--zl-color-surface-default-secondary-gray` | `--zl-muted` / `--zl-secondary` |
| `--zl-color-text-primary-white` | `--zl-foreground` |
| `--zl-color-text-secondary-gray` | `--zl-muted-foreground` |
| `--zl-color-text-error` / `--zl-color-icon-error` | `--zl-destructive` |
| `--zl-color-border-default-gray-*` | `--zl-border` / `--zl-input` |
| `--zl-color-gray-*` (raw ramp) | no 1:1 — use a semantic token |

### Gaps (shadcn ships no source)

`--zl-color-text-success` / `status-positive` (no success ramp — keep legacy
`#33a779` or add a Figma variable) and interaction states like
hover/pressed fills that Figma expresses as opacity overlays.
