# Agent Instructions — `apps/storybook`

The workbench for the login surface: one `@storybook/web-components-vite`
instance hosting `@zitadel/components`' atoms and orchestrators, the
orchestrators driven by `@zitadel/api-mock`. Console UI iterates on the console
dev server instead (ADR 055). Commands and coverage: [`README.md`](README.md).

It is the team's tool, never deployed: customers see the components in the
docs' live examples ([`apps/docs/AGENTS.md`](../docs/AGENTS.md#live-examples)).

## Hard rules

- One instance, one renderer: no Storybook Composition, second Storybook or
  React renderer.
- One story file per atom (`src/<id>.stories.ts`), exporting one `Default`
  under `Atoms/<Name>`. States are controls (`args`/`argTypes`, e.g.
  `previewState`), never extra stories or "matrix" grids.
- Visuals come from `@zitadel/design-tokens`; an atom's CSS is
  `packages/components/src/atoms/zl-<id>.css`. Stories never restyle atoms.
- Add a `play` only when no lower layer can prove the behaviour; atoms prove
  theirs in `packages/components` specs. This app gates render and a11y.
- Only orchestrator stories give the one MSW worker handlers
  (`parameters.msw`), and they are tagged `no-test` to keep the network out of
  the test run.
- The build is relocatable: address files relative to the page or Vite's
  base, never from `/`. The MSW worker follows the base.

## Orchestrator stories

`<zitadel-login>` renders whatever the flow engine returns; here that engine is
`@zitadel/api-mock`. Group controls with `argTypes.<name>.table.category`:
**Component** for host props (`purpose`, `variant`, `theme`, `previewState`),
**Flow engine** for mock overlays applied in `beforeEach` (`branding`, `sso`,
`passkey`).

- The orchestrator ignores the document's `data-theme`: it paints from the
  flow's branding (`theme-controller.ts`). A branding with one palette side
  forces that side, so the `theme` control toggles only with two-sided
  presets.
- `layout` comes from the backend and has no element prop. `split` renders
  only through the legacy `*-template` presets, so never add a `layout`
  control.
- `branding` presets (`branding-presets.ts`) are fixtures applied through
  `applyBranding`; `none` leaves the design-system defaults.
- `sso` providers derive from `SHIPPED_BRAND_ICON_NAMES`
  (`orchestrator-shared.ts`), so a glyph added in `@zitadel/components` shows
  up on its own. Never hard-code a provider list.
- `sso` and `passkey` stay off by default, so the mock mirrors the shipped
  flow and the api-mock conformance spec stays green.
- Keep controls scalar (enums, booleans): args round-trip through the URL, and
  object controls break shareable links.
- Never remove the story-id-and-args key on the mock-backed subtree in
  `.storybook/preview.ts`: without it, a flow driven to `done` leaks into the
  next story.
- `passkey-login` stories stub `navigator.credentials` with
  `freezePasskeyCeremony()` in `beforeEach`. Keep that stub in the workbench;
  the login element gets no "skip the ceremony" prop.
- Not storied on purpose: `passkey-setup` / `passkey-upsell` (legacy; the
  default flow no longer routes through them) and `sso-redirect` (it
  navigates away).
- A `play` that fills the password uses `PASSWORD_FIELD`
  (`x-auth-methods#password`), never `"password"`.
- After changing a control or preset, load the stories and read the resolved
  state (host `data-theme`, provider buttons, the step) across branding ×
  theme × sso. Do not infer it from the code.

## Recipe: add an atom (Figma → Storybook)

Each step's package has its own `AGENTS.md`; follow it.

1. **Design.** Pull the frame with the Figma MCP (`get_design_context`,
   `get_screenshot`); note states, the WAI-ARIA pattern and tokens. A missing
   value is a new token in `@zitadel/design-tokens`.
2. **Icon**, if new: `packages/components/src/atoms/zl-icon.ts` (`IconName`,
   `SHIPPED_ICON_NAMES`, `ICON_NODES`).
3. **CSS**: `src/atoms/zl-<id>.css` beside the atom, `:host`/slot rules first,
   then the painted `.zr-<id>` surface.
4. **Atom**: `src/atoms/zl-<id>.ts`. An atom that holds a value extends
   `FormAtom` (`src/internal/form-atom.ts`); never hand-roll
   `formAssociated`. Import the CSS with `?inline`, export a manifest, export
   the atom from `src/atoms/index.ts`, add the manifest to `src/manifests.ts`
   and the public API to `src/index.ts`.
5. **Tests**, at the lowest layer that proves the property: `zl-<id>.spec.ts`
   (jsdom: markup, ARIA), `zl-<id>.browser.spec.ts` (Chromium: form, keyboard,
   focus) only if needed, the tag in `src/manifests.spec.ts` and its events in
   `src/atoms/event-contract.spec.ts`.
6. **Story**: `src/<id>.stories.ts`, one `Default` under `Atoms/<Name>`.
7. **Verify** with `moon run storybook:dev` (HMR from source), then
   `moon run components:test storybook:typecheck storybook:test`. While
   iterating, `pnpm --filter @zitadel/components test:unit` is the fast lane.

## Local checks

```sh
moon run storybook:typecheck storybook:build storybook:test
```

`storybook:test` runs real Chromium and re-bundles its dependencies on every
start (`optimizeDeps.force`), so every run starts cold. Never pipe it through
`tail`, and clear strays before a retry; see
[`packages/components/AGENTS.md`](../../packages/components/AGENTS.md#the-browser-projects-cold-start).
