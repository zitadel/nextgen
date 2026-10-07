# @zitadel/storybook

The component workbench for the login surface. **One** Storybook instance,
built with `@storybook/web-components-vite`, hosts `@zitadel/components`:

- **Lit atoms** (`<zl-*>`) — native web-components stories.
- **Orchestrators** (`<zitadel-login>`, `<zitadel-session>`) — the API is
  mocked by `@zitadel/api-mock` through `msw-storybook-addon`; flow purpose and
  tenant branding are story controls.

Everything here is a custom element, so the web-components renderer shows it
natively: one instance, one renderer. Console UI iterates on the console dev
server, not here (ADR 055).

Each atom is **one** story file under an `Atoms/<Name>` title exporting a
single `Default` story, with no `Playground` nesting.

## Run it

```sh
moon run storybook:dev     # http://localhost:6006
moon run storybook:build   # static build into dist/
moon run storybook:test    # run every story as a real-browser test
```

`build` and `test` depend on `components:build` and `design-tokens:build`.
`dev` has no build dependency: `.storybook/main.ts` aliases
`@zitadel/components` to its source, so atom edits hot-reload.

## Coverage

Each atom story file exports `Default` under `Atoms/<Name>`; the orchestrators
sit under `Orchestrator/`:

| Story | Element | Tags |
| --- | --- | --- |
| `Atoms/Alert` | `<zl-alert>` | `autodocs` |
| `Atoms/Button` | `<zl-button>` | `autodocs` |
| `Atoms/Card` | `<zl-card>` | `autodocs` |
| `Atoms/Checkbox` | `<zl-checkbox>` | `autodocs` |
| `Atoms/Icon` | `<zl-icon>` | `autodocs` |
| `Atoms/Page Shell` | `<zl-page-shell>` | `autodocs` |
| `Atoms/Pill` | `<zl-pill>` | `autodocs` |
| `Atoms/Select` | `<zl-select>` | `autodocs` |
| `Atoms/SSO providers` | `<zl-sso-providers>` | `autodocs` |
| `Atoms/Text Field` | `<zl-field>` | `autodocs` |
| `Orchestrator/Login` | `<zitadel-login>` | `no-test` |
| `Orchestrator/Login/SSO` | `<zitadel-login>` | `no-test` |
| `Orchestrator/Session` | `<zitadel-session>` | `no-test` |

`<zl-passkey>` has no story: it drives `navigator.credentials` and is covered
by its `packages/components` spec. The atom stories carry no `play` function,
following the "don't duplicate behaviour upward" rule below.

## Tests

`moon run storybook:test` runs `@storybook/addon-vitest`, which turns each
story into a real-browser (Playwright Chromium) Vitest test: a render smoke
test, the `a11y: { test: "error" }` checks from `.storybook/preview.ts`, and
the story's `play` function _when it has one_. This is the component gate, and
it runs in CI via `moon ci :test`. Orchestrator stories are tagged `no-test` (they drive real
network + the MSW worker; their behaviour is covered by the
`@zitadel/components` specs).

## Conventions

- **One component, controls for state.** Each story is the single component
  driven by `args`/`argTypes` controls (the "knobs") — not a grid of static
  instances and not one story per state. Use a control (e.g. `previewState`) to
  flip interaction states rather than rendering a hand-rolled matrix.
- **One story file per atom.** `src/<id>.stories.ts` exports a single
  `Default` story under an `Atoms/<Name>` title.
- **Don't duplicate behaviour upward.** A story gets a `play` function only
  when no lower layer already proves the behaviour. The Lit atoms own their
  toggle/form/focus behaviour in `packages/components` specs (`*.spec.ts` +
  `*.browser.spec.ts`), so their stories carry no `play` — they ride the
  automatic render smoke + a11y pass.
- Visual values come from `@zitadel/design-tokens` (loaded once in
  `.storybook/preview.ts`); never hard-code colours in a story.
- The dark canvas in `src/preview.css` matches the login surface's default
  mode (see `docs/adrs/055-lit-only-login-surface.md`).
