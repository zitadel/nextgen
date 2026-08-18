# Agent Instructions — `apps/storybook`

The unified component workbench. Read together with the
[root `AGENTS.md`](../../AGENTS.md) and [`README.md`](README.md).

## What's in here

A single `@storybook/web-components-vite` instance that hosts `@zitadel/components`
— the Lit atoms and the orchestrators (`<zitadel-login>`, `<zitadel-session>` —
see `src/session.stories.ts`) — so atoms can be checked against Figma and the
orchestrators can be driven against `@zitadel/api-mock`. This is the workbench
for the **login surface only**; console UI iterates on the console dev server
(ADR 052). It is a dev tool, not a shipped package
(`private`, no `dist`, `build` is `runInCI: false`), but `storybook:test` runs
in CI.

## Hard rules

- **One instance, one renderer.** Everything here is a custom element and
  renders natively. Do not add Storybook Composition, a second Storybook, or a
  React renderer — that's the pattern this app exists to avoid.
- **One component, controls for state.** A story is the single component driven
  by `args`/`argTypes` controls — not a grid of static instances and not one
  story per state. Use a control (e.g. `previewState`) to flip interaction
  states. Do not reintroduce hand-rolled "matrix" stories.
- **One story file per atom, one story in it.** `src/<id>.stories.ts` exports
  `Default` under an `Atoms/<Name>` title. Don't split an atom across files or
  add a redundant second (`Playground`) level.
- **Tokens, not magic values.** Visuals come from `@zitadel/design-tokens`
  (imported once in `.storybook/preview.ts`). An atom's CSS is owned by
  `packages/components/src/atoms/zl-<id>.css`; stories never restyle atoms.
- **Behaviour lives in the source packages; don't duplicate upward.** This app
  gates render + a11y for every story. Add a `play` function only when no lower
  layer proves the behaviour — the atoms own toggle/form/focus in
  `packages/components` specs, so their stories generally carry no `play`.
- **MSW is orchestrator-only.** The atoms make no requests, so
  `msw-storybook-addon` is wired on the orchestrator stories (not globally),
  and those stories are tagged `no-test` to keep network out of the test run.

## Recipe: add an atom (Figma → Storybook)

The repeatable flow that built `select`. Each step links the package whose
scoped `AGENTS.md` owns the rules — read those rather than rediscovering them.

1. **Design.** Pull the frame with the Figma MCP (`get_design_context` /
   `get_screenshot`); note the states, the WAI-ARIA pattern, and which tokens it
   uses. A missing value is a new token in `@zitadel/design-tokens` — never a
   magic value in CSS.
2. **Icon (only if new).** Add the glyph to
   `packages/components/src/atoms/zl-icon.ts` (`IconName` union +
   `SHIPPED_ICON_NAMES` + `ICON_NODES`).
3. **CSS** (`packages/components`, see its `AGENTS.md`): create
   `src/atoms/zl-<id>.css` beside the atom — `:host`/slot rules first, then the
   painted `.zr-<id>` surface. One file; there is no separate host sheet.
4. **Lit atom** (`packages/components`, see its `AGENTS.md`): create
   `src/atoms/zl-<id>.ts` — `static formAssociated = true` if it holds a value,
   import the CSS with `./zl-<id>.css?inline`, and export a manifest. Register:
   export from `src/atoms/index.ts`, add the manifest to `src/manifests.ts`, and
   re-export the public API from `src/index.ts`.
5. **Tests — lowest layer that proves the property** (don't duplicate upward):
   - `src/atoms/zl-<id>.spec.ts` (jsdom: markup + ARIA).
   - `src/atoms/zl-<id>.browser.spec.ts` (chromium: form participation,
     keyboard, focus) — only if it has real-platform behaviour.
   - Add the tag to `src/manifests.spec.ts` and its events to
     `src/atoms/event-contract.spec.ts`.
6. **Story** (`src/<id>.stories.ts`): one `Default` story under an
   `Atoms/<Name>` title. States are knobs, not extra stories.
7. **Verify.** Dev loop: `storybook dev -p 6006` (HMR from source). Gate:
   `moon run components:test` (unit), `moon run storybook:typecheck`, and
   `moon run storybook:test` (render + a11y + plays in Chromium).

## Local checks

```sh
moon run storybook:typecheck
moon run storybook:build
moon run storybook:test
```

`storybook:test` (and any `--project browser` Vitest run) launches real Chromium
and pre-bundles the workspace from source, so the **first** run is slow
(60–120s+) while later runs are fast on a warm `node_modules/.vite` cache — it is
not hung. Don't pipe it through `tail` (buffers until EOF) and don't kill-and-
retry without first clearing strays (`pkill -f vitest; pkill -f chrome-headless-shell`),
or the next run stalls on `Port … is in use`. See
[`packages/components/AGENTS.md`](../../packages/components/AGENTS.md#the-browser-project-hangs--it-doesnt-its-cold-start).
