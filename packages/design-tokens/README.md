# @zitadel/design-tokens

The single source of truth for ZITADEL NextGen visual design. Pulls
Variables from the published [Zitadel Design System — External][figma]
Figma library, supplements them with the few values Figma doesn't
publish (typography stacks, motion, focus ring, breakpoints, container
widths), and emits three artifacts consumers can rely on:

| Surface              | Path                                          | Consumer                                                |
| -------------------- | --------------------------------------------- | ------------------------------------------------------- |
| CSS variables        | `@zitadel/design-tokens/css/tokens.css` | Lit atoms, orchestrator chrome, tenant CSS              |
| Tailwind v4 `@theme` | `@zitadel/design-tokens/css/tailwind.css` | `apps/console`, any React/Vue consumer using Tailwind v4 |
| Typed TS constants   | `@zitadel/design-tokens`              | Paired React components in `packages/ui-react`, any TS consumer |

Every token is namespaced with `--zl-*` (and `--*-zl-*` in the Tailwind
block) so it never collides with consumer tokens.

[figma]: https://www.figma.com/design/8UjCXw8yemgljmbkWGrSfE/Zitadel---Design-System---External

## Why a separate package?

Lit web components and React console components need to render the same
pixels. Without a shared token surface, each side ends up re-typing hex
codes and slowly drifting. This package owns that surface so the
contract is one rebuild away, never a copy-paste.

## How a sync works

`figma-tokens.lock` pins the Figma published library version that
`src/generated/figma.tokens.json` was built from. The lockfile is the
only knob that controls what gets pulled.

```sh
FIGMA_TOKEN=… pnpm nx run @zitadel/design-tokens:sync
pnpm nx run @zitadel/design-tokens:generate
pnpm nx run @zitadel/design-tokens:test       # snapshot guard
```

In CI, [`.github/workflows/sync-design-tokens.yml`](../../.github/workflows/sync-design-tokens.yml)
runs the same sequence on a manual trigger and opens a PR with the diff.
Sync **never** commits to `main` directly.

## Safety guarantees

- **Pinned library version.** Designers can edit Figma freely; production
  only sees changes when the lockfile is bumped in a PR.
- **Snapshot test.** `src/tokens.snapshot.spec.ts` locks every public
  token name. A rename or deletion fails CI before consumers break.
- **Deterministic build.** Same JSON in, byte-identical artifacts out.
  Reviewers diff `src/generated/*` directly.
- **Two-layer model.** Figma's `Primitives` collection holds raw hex /
  px values; the `Tokens` collection holds semantic aliases (`color/
  border/error → color.pink.500`). Atoms only ever reach for semantic
  names, so a primitive ramp change cascades automatically.

## File map

```
packages/design-tokens/
├── figma-tokens.lock                 ← pinned library version (committed)
├── scripts/
│   ├── sync-from-figma.ts            ← Figma REST → figma.tokens.json
│   └── build.ts                      ← figma.tokens.json + overrides → outputs
├── src/
│   ├── overrides.ts                  ← typography, motion, focus, breakpoints,
│   │                                   container widths (committed)
│   ├── tokens.snapshot.spec.ts       ← public-name guard
│   └── generated/                    ← all committed; built by `:generate`
│       ├── figma.tokens.json
│       ├── tokens.css
│       ├── tokens.ts
│       └── tailwind.css
└── dist/                             ← gitignored; built by tsdown for npm
```

## Adding a new token

1. Add the variable in Figma → publish the library → bump
   `figma-tokens.lock.version`.
2. Run `:sync`, `:generate`, `:test`. Update the snapshot if the new
   name is intentional; otherwise fix the input.
3. Commit the resulting `figma.tokens.json`, `tokens.{css,ts}`, and
   `tailwind.css` together with the lockfile bump.

For values Figma doesn't own (typography stacks, motion, etc.), edit
`src/overrides.ts` and re-run `:generate`.

## Why not Style Dictionary / Tokens Studio?

Both were considered. Style Dictionary needs config, transforms, and
formats registered for our three target surfaces; Tokens Studio's
GitHub bot writes to the repo without a PR review by default. A
~200-line build script is more readable, easier to debug, and keeps the
PR-gated review property intact. Swap if the token surface grows past
what the script can serve cleanly.
