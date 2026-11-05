# Agent Instructions — `packages/design-tokens`

The Figma-driven `--zl-*` variables, the one contract the login surface and the
console share (ADR 055). Consumer docs: [`README.md`](README.md).

## Authority

1. The published Figma library (its file key is in `figma-tokens.lock`).
   Semantic colours come from the committed DTCG export in `figma-export/`
   (`:sync-export`): the REST `:sync` cannot read variables without Figma
   Enterprise.
2. `src/overrides.ts`, only for values Figma does not own (font fallbacks,
   motion curves, breakpoints), each with a doc comment saying why.
3. Nothing else: atoms declare no hex codes, and consumers never re-derive
   radii or spacing.

A value that belongs to the design system goes into Figma and is re-synced.

## Syncing

- The Figma plugin pushes `figma-export/` to the branch
  `design-tokens/figma-sync`; CI (`sync-design-tokens.yml`) merges `main` into
  it and opens the sync PR.
- `:sync-export` (`scripts/sync-from-export.ts`) resolves every `*.json` under
  `figma-export/` through one alias registry. Never pick exports by file name,
  and never downgrade an unresolved reference or an empty colour surface to a
  warning.
- After any sync, run `:generate` and review the snapshot diff.
- Each collection's role is declared in [`src/collections.ts`](src/collections.ts),
  keyed by its Figma collection name, never inferred from its shape. The
  roles and what each emits are documented on `CollectionRole`.
- A collection the manifest does not name falls back to `registry-only`, with
  a warning, and the sync PR still opens; `sync-from-export.spec.ts` then
  fails `full-pr` until someone classifies it. A stale entry fails it the same
  way.
- Never turn those failures into throws: `:sync-export` runs before the sync
  PR exists, so a throw leaves no check, only a log. The `semantic` role is
  the exception: anything but exactly one such collection throws, because
  there is no safe default.

## Colour surfaces

- The shadcn roles (`--zl-background`, `--zl-primary`, …) live under
  `tokens.theme.*` as `{ dark, light }` pairs; `build.ts` emits the light
  halves under `[data-theme="light"]`.
- Themed groups (`--zl-syntax-*`, `--zl-gradient-*`) theme the same way but
  stay out of `css/shadcn.css`, which owns the unprefixed shadcn contract.
- Composed gradients (`--zl-gradient-red`) are built in `build.ts` from the
  exported colours, at the angles and stops in `overrides.ts`, until Figma
  publishes those as variables.
- The console imports `css/shadcn.css` and authors the unprefixed utilities
  (`bg-background`, `text-muted-foreground`); never reintroduce `bg-zl-*`
  there.

## Changing the package

- Never hand-edit `src/generated/`: `:sync`/`:sync-export` and `:generate`
  overwrite it. Fix the input (lock, export or overrides) and regenerate.
- `figma-tokens.lock` changes only in a sync PR.
- `scripts/build.ts` must stay deterministic. A new category in
  `overrides.ts` needs `build.ts` to emit it, appended after the existing
  ones so the diff does not shift every line.
- `scripts/sync-from-figma.ts` runs in CI with a real token; keep its
  pinned-library guarantee.
- Update `src/tokens.snapshot.spec.ts` only for an intended rename, after
  reviewing what consumers need; extend it to cover a new category's keys.
- Never import this package from `packages/api` or `packages/api-mock`.

## Branding at runtime

The orchestrator paints a flow's branding, which arrives in the flow response,
by writing the same `--zl-*` variables on its own shadow root
(`packages/components/src/orchestrator/branding-to-tokens.ts`). There is no
`branding` attribute; never add a separate branding-token surface.
