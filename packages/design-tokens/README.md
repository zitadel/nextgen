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

### Figma plugin push (default)

A Figma Community sync plugin pushes DTCG JSON to GitHub. Plugin settings:

| Field | Value |
| --- | --- |
| Name (repo) | `nextgen` |
| Branch | `design-tokens/figma-sync` |
| Token path | `packages/design-tokens/figma-export` |

CI ([`.github/workflows/sync-design-tokens.yml`](../../.github/workflows/sync-design-tokens.yml))
runs on push to that branch under `figma-export/**` → `:sync-export` →
`:generate` → `:test` → opens or **updates one PR**.

### Engineering path (Enterprise only)

REST sync via `workflow_dispatch` with `figma-rest`, or locally:

```sh
FIGMA_TOKEN=... moon run design-tokens:sync
moon run design-tokens:generate
moon run design-tokens:test
```

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
├── figma-export/                     ← DTCG JSON from Figma plugin push (Semantic only)
├── scripts/
│   ├── sync-from-export.ts           ← figma-export → figma.tokens.json
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

1. Add the variable in Figma → publish the library.
2. Push from the Community sync plugin (or run `:sync-export` locally if you
   have a committed export under `figma-export/`).
3. Run `moon run design-tokens:generate` and `moon run design-tokens:test`.
   Update the snapshot if the new name is intentional.
4. Commit `figma.tokens.json`, `tokens.{css,ts}`, and `tailwind.css` together
   in the sync PR.

For Enterprise REST sync instead: bump `figma-tokens.lock.version`, run
`:sync`, then `:generate` and `:test`.

For values Figma doesn't own (typography stacks, motion, etc.), edit
`src/overrides.ts` and re-run `:generate`.

## Why not Style Dictionary / Tokens Studio?

Both were considered. Style Dictionary needs config, transforms, and
formats registered for our three target surfaces; Tokens Studio's
GitHub bot writes to the repo without a PR review by default. A
~200-line build script is more readable, easier to debug, and keeps the
PR-gated review property intact. Swap if the token surface grows past
what the script can serve cleanly.
