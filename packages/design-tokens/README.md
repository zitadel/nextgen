# @zitadel/design-tokens

The single source of truth for ZITADEL NextGen visual design. Pulls
Variables from the published [Zitadel Design System — External][figma]
Figma library, supplements them with the few values Figma doesn't
publish (typography stacks, motion, focus ring, breakpoints, container
widths), and emits three artifacts consumers can rely on:

| Surface              | Path                                          | Consumer                                                |
| -------------------- | --------------------------------------------- | ------------------------------------------------------- |
| CSS variables        | `@zitadel/design-tokens/css/tokens.css` | Lit atoms, orchestrator chrome, tenant CSS              |
| Tailwind v4 `@theme` | `@zitadel/design-tokens/css/tailwind.css` | Consumers that want the `--*-zl-*` / `bg-zl-*` utilities |
| shadcn bridge        | `@zitadel/design-tokens/css/shadcn.css` | `apps/console` (unprefixed `bg-background`, …)          |
| Typed TS constants   | `@zitadel/design-tokens`              | Paired React components in `packages/ui-react`, any TS consumer |

Every token is namespaced with `--zl-*` (and `--*-zl-*` in the Tailwind
block) so it never collides with consumer tokens.

[figma]: https://www.figma.com/design/8UjCXw8yemgljmbkWGrSfE/Zitadel---Design-System---External

## Two token systems, side by side

The package currently emits **two** colour surfaces so consumers can migrate
incrementally rather than in one breaking change:

| System | Var shape | Source | Status |
| --- | --- | --- | --- |
| Legacy | `--zl-color-surface-*`, `--zl-color-text-*`, `--zl-color-gray-*`, `--zl-spacing-*`, `--zl-radius-*` | `src/legacy.tokens.json` (frozen) | being migrated away from |
| shadcn | `--zl-background`, `--zl-foreground`, `--zl-primary`, `--zl-card`, `--zl-border`, `--zl-sidebar-*`, `--zl-chart-*` | designer DTCG export (`figma-export/`) | the target surface |
| Themed groups | `--zl-syntax-*`, `--zl-gradient-*` | designer DTCG export (`figma-export/`) | additive |

Themed groups are the designer's Light/Dark collections beyond the shadcn
roles — syntax highlighting colours and gradient stops. They live under
`tokens.<group>.*` and are aliased for Tailwind as `bg-zl-gradient-red-start`,
`text-zl-syntax-key`. They are not part of the unprefixed shadcn contract in
`css/shadcn.css`, so reach them by their `--zl-*` or `zl-`-prefixed names.

All are themed: dark values live on `:root` / `[data-theme="dark"]`, light
overrides on `[data-theme="light"]`. The new shadcn names never collide with the
legacy `--zl-color-*` namespace, so a file can reference either (or both) during
migration. In the typed export, legacy colours stay under `tokens.color.*` and the
new surface lives under `tokens.theme.*`.

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
runs on push to that branch under `figma-export/**` → **merges `main` into
`design-tokens/figma-sync`** (so the long-lived branch cannot go stale) →
`:sync-export` → `:generate` → commits generated artifacts **on top of** the
plugin's `figma-export` commits (no rebase/force-push) → opens or **updates
one PR** titled `chore: sync tokens from Figma` → `:test` as a **hard gate**.
The snapshot test runs after the PR is opened (so a legitimate rename still
surfaces its diff for review) but is no longer `continue-on-error`, so a name
change turns the PR check red instead of merging silently.

`:sync-export` is intentionally **file-name agnostic**: it reads every `*.json`
under `figma-export/`, builds one registry of leaf values, resolves every
`{alias}` (cross-collection and per-mode) to a concrete value, and **fails loud**
if any reference is unresolved or the themed colour surface comes out empty.
Silently dropping a designer's variables (the old filename-coupled behaviour) is
treated as a bug, not a warning.

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
  token name (both legacy `tokens.color.*` and new `tokens.theme.*`). A
  rename or deletion fails CI before consumers break.
- **Resolver unit test.** `src/sync-from-export.spec.ts` covers alias
  resolution, base-group flattening, concrete-wins conflicts, and fail-loud
  behaviour, and re-runs the resolver against the real checked-in exports.
- **Fail-loud ingest.** `:sync-export` throws on any unresolved reference or
  an empty colour surface, so a broken designer push stops the workflow before
  it can open a PR with silently-dropped tokens.
- **Declared roles.** `src/collections.ts` says what each Figma collection is
  (`semantic`, `themed`, `viewport`, `primitives`, `registry-only`), so adding
  or renaming a collection in Figma is a decision someone makes rather than one
  the resolver guesses. An unclassified export defaults to `registry-only` and
  is reported in `$source.unclassifiedCollections`, where the resolver spec
  fails on it — a red check on the sync PR, rather than a throw that would kill
  the workflow before any PR exists. Within a role, two collections landing on
  the same key throws. The snapshot test cannot catch any of this, because it
  only sees names that already reached `build.ts`.
- **Deterministic build.** Same JSON in, byte-identical artifacts out.
  Reviewers diff `src/generated/*` directly.
- **Alias resolution.** The designer's export layers primitives (`tailwind
  colors.*`) → named theme pairs (`colors.<name>-light/dark`) → semantic
  `base.*` per Light/Dark mode. The resolver walks that whole chain so a
  primitive change cascades automatically; consumers only ever see the
  resolved semantic `--zl-*` names.

## File map

```
packages/design-tokens/
├── figma-tokens.lock                 ← pinned library version (committed)
├── figma-export/                     ← DTCG JSON from Figma plugin push
├── scripts/
│   ├── sync-from-export.ts           ← figma-export/*.json → figma.tokens.json (generic resolver)
│   ├── sync-from-figma.ts            ← Figma REST → figma.tokens.json
│   └── build.ts                      ← legacy.tokens.json + figma.tokens.json + overrides → outputs
├── src/
│   ├── collections.ts                ← what each Figma collection is (roles)
│   ├── legacy.tokens.json            ← frozen legacy colour source (committed)
│   ├── overrides.ts                  ← typography, motion, focus, breakpoints,
│   │                                   container widths (committed)
│   ├── tokens.snapshot.spec.ts       ← public-name guard (both surfaces)
│   ├── sync-from-export.spec.ts      ← resolver unit + real-export test
│   └── generated/                    ← all committed; built by `:generate`
│       ├── figma.tokens.json         ← resolved shadcn surface (written by :sync-export)
│       ├── tokens.css
│       ├── tokens.ts
│       ├── tailwind.css
│       └── shadcn.css                ← shadcn utility bridge for apps/console
└── dist/                             ← gitignored; built by tsdown for npm
```

The export currently contains nine collections (Tailwind primitives, named
theme colours, Light/Dark modes, viewport typography, an icon-library flag, a
brand palette, gradient stops, heading typography, and syntax colours), but the
resolver does not care about their file names — add, rename, or split export
files freely. What each one *is* is declared in `src/collections.ts`; see the
role table in [AGENTS.md](AGENTS.md). A collection can be `registry-only`:
`brand` exists purely to be referenced by `{brand.*}` aliases and surfaces no
variables of its own.

## Adding a new token

1. Add the variable in Figma → publish the library.
2. Push from the Community sync plugin (or run `:sync-export` locally if you
   have a committed export under `figma-export/`). If the variable landed in a
   **new collection**, the sync stops until you give it a role in
   `src/collections.ts` — that is deliberate.
3. Run `moon run design-tokens:generate` and `moon run design-tokens:test`.
   Update the snapshot if the new name is intentional.
4. Commit `figma.tokens.json`, `tokens.{css,ts}`, `tailwind.css`, and
   `shadcn.css` together in the sync PR.

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
