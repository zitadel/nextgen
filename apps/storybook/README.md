# @zitadel/storybook

The unified component workbench. **One** Storybook instance — built with
`@storybook/web-components-vite` — hosts both component libraries and the
orchestrator:

- **Lit atoms** (`@zitadel/components`, `<zl-*>`) — native web-components stories.
- **Orchestrator** (`<zitadel-login>`) — the Flow API is mocked by
  `@zitadel/api-mock` through `msw-storybook-addon`; flow purpose and tenant
  branding are story controls.

## Why one instance, not two

Storybook can't run two framework _renderers_ in a single instance, and its
"multi-framework" answer (Composition) means running a Storybook per framework
plus a host that iframes them — more moving parts, not fewer. We avoid that:

- the Lit atoms are plain custom elements, so the web-components renderer shows
  them natively;
- React components render into a returned `Node` (lit-html renders nodes), so
  they sit in the same instance.

Each atom is **one** story file under an `Atoms/<Name>` title exporting a
single `Default` story
in the sidebar with no extra per-renderer or `Playground` nesting.

## Run it

```sh
moon run storybook:dev     # http://localhost:6006
moon run storybook:build   # static build into storybook-static/
moon run storybook:test    # run every story as a real-browser test
```

`dev`/`build`/`test` depend on `components:build` and `design-tokens:build`,
because the atom registration import resolves the built `@zitadel/components`
entry and the `--zl-*` variables come from the built token layer.

## Coverage

Every atom has a story file exporting `Default` under `Atoms/<Name>`, plus
the orchestrator under `Orchestrator/`:

| Story | Lit | React | `play` |
| --- | --- | --- | --- |
| `Atoms/Alert` | `<zl-alert>` | `<Alert>` | — |
| `Atoms/Button` | `<zl-button>` | `<Button>` | — |
| `Atoms/Card` | `<zl-card>` | `<Card>` | — |
| `Atoms/Checkbox` | `<zl-checkbox>` | `<Checkbox>` | React (toggle) |
| `Atoms/Icon` | `<zl-icon>` | `<Icon>` | — |
| `Atoms/Page Shell` | `<zl-page-shell>` | `<PageShell>` | — |
| `Atoms/Pill` | `<zl-pill>` | `<Pill>` | — |
| `Atoms/Select` | `<zl-select>` | `<Select>` | — |
| `Atoms/Text Field` | `<zl-field>` | `<TextField>` | React (clear) |
| `Orchestrator/Login` | `<zitadel-login>` | — | — (`no-test`) |
| `Orchestrator/Session` | `<zitadel-session>` | — | — |

`<zl-passkey>` is intentionally **not** in Storybook: it's an invisible WebAuthn
ceremony handler (no rendered surface, no React pair, drives
`navigator.credentials`), so it's covered by its `packages/components` spec
instead. The `play` column follows the "don't duplicate behaviour upward" rule
below — only the React pairs with DOM-observable interaction and no
component-level spec carry one.

## Tests

`moon run storybook:test` runs `@storybook/addon-vitest`, which turns each
story into a real-browser (Playwright Chromium) Vitest test: a render smoke
test, the `a11y: { test: "error" }` checks from `.storybook/preview.ts`, and
the story's `play` function _when it has one_. This is the component gate that
replaced the old `apps/console-e2e` visual-parity sweep and it runs in CI via
`moon ci :test`. Orchestrator stories are tagged `no-test` (they drive real
network + the MSW worker; their behaviour is covered by the
`@zitadel/components` specs).

## Conventions

- **One component, controls for state.** Each story is the single component
  driven by `args`/`argTypes` controls (the "knobs") — not a grid of static
  instances and not one story per state. Use a control (e.g. `previewState`) to
  flip interaction states rather than rendering a hand-rolled matrix.
- **One story file per atom.** `src/<id>.stories.ts` exports a single
  `Default` story under an `Atoms/<Name>` title.
- **Don't duplicate behaviour upward.** A renderer gets a `play` function only
  when no lower layer already proves the behaviour. The Lit atoms own their
  toggle/form/focus behaviour in `packages/components` specs (`*.spec.ts` +
  `*.browser.spec.ts`), so their stories carry no `play` — they ride the
  automatic render smoke + a11y pass. The React pairs have no component-level
  spec, so their story's `play` is the sole behavioural test for them.
- Visual values come from `@zitadel/design-tokens` (loaded once in
  `.storybook/preview.ts`); never hard-code colours in a story.
- The dark canvas in `src/preview.css` matches the login surface's default
  mode (see `docs/adrs/052-lit-only-login-surface.md`).
