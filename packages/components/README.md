# @zitadel-nextgen/components

Lit-based atomic web components and the `<zitadel-login>` orchestrator for the
Zitadel auth UI.

The package ships:

- **Atoms** — `<zl-field>`, `<zl-submit>`, `<zl-action>`, `<zl-error>`. Form-
  associated, accessible, branding-aware Lit elements that map 1:1 to the
  primitives the flow API talks about.
- **Orchestrator** — `<zitadel-login>`. A single drop-in element that talks to
  the flow API, renders each step through a Liquid template, manages focus and
  form submission, and applies branding/theme/locale.
- **Tokens & manifests** — design tokens (`--zl-*` CSS custom properties), a
  Liquid template registry, and per-atom manifests describing allowed
  attributes/parts/events for sanitiser allowlists.

It is consumed directly by tenants embedding the auth UI on their own pages
and indirectly by the `apps/console` shell.

## Status

Pre-release substrate. APIs are stabilising alongside
[`docs/design/branding/`](../../docs/design/branding/) and
[`docs/design/flowengine/`](../../docs/design/flowengine/). Expect minor breaks
until the first published version. See
[`docs/design/branding/form-participation.md`](../../docs/design/branding/form-participation.md)
for the form-association / accessibility decisions baked into every input atom.

## Install

```sh
corepack pnpm add @zitadel-nextgen/components
```

`lit`, `liquidjs`, and `dompurify` are peer/runtime deps and are intentionally
externalised so npm consumers dedupe with their own copies.

## Quickstart — drop on a page

The 90% case: paste the element, hand it a backend URL, locale, and branding.
It owns everything else.

```html
<script type="module" src="@zitadel-nextgen/components"></script>

<zitadel-login id="login" purpose="login" project-id="proj_123"></zitadel-login>

<script type="module">
  const el = document.getElementById('login');
  el.baseUrl = 'https://api.tenant.com/v2/flow';
  el.branding = await fetch('/branding').then((r) => r.json());
  el.locale = await fetch('/i18n/en.json').then((r) => r.json());
</script>
```

What you get without writing a line of UI code:

- `POST /flow/start` on mount, full step traversal, `complete` redirect.
- Native `<form>` semantics: Enter submits, password managers see the inputs,
  `<button type="submit">` works, browser autofill works.
- Focus moved to the first field on every step change.
- Branding tokens mapped to CSS variables on the shadow root.
- Light/dark theme via `prefers-color-scheme`, hot-swappable.
- Mandatory gates (terms, captcha) enforced before submit.
- Output sanitised with DOMPurify against a per-atom allowlist before injection.

### React / Astro / Next

Same element, lifted into JSX. Pass objects through `ref` rather than as
attributes (web component properties are typed objects, not stringified
attributes).

```tsx
import '@zitadel-nextgen/components';

export function Login({ branding, locale }: Props) {
  return (
    <zitadel-login
      purpose="login"
      project-id="proj_123"
      base-url="https://api.tenant.com/v2/flow"
      ref={(el) => {
        if (!el) return;
        el.branding = branding;
        el.locale = locale;
      }}
    />
  );
}
```

### Custom transport (offline demos, fixtures)

Replace the network with a `FlowTransport` implementation. The package ships
two:

- `FetchTransport` — wraps `fetch` against a base URL.
- `FixtureTransport` — replays a pre-baked sequence of `FlowResponse` objects.
- `WalkingFixtureTransport` — walks `step.transitions` of a `FlowDefinition`
  graph; useful for visualizers and demos that exercise multiple branches.

```ts
import { WalkingFixtureTransport } from '@zitadel-nextgen/components';

el.transport = new WalkingFixtureTransport({
  flow: myFlowDefinition,
  purpose: 'login',
  branding,
});
```

### Atoms-only (bypass the orchestrator)

If you want a fully bespoke shell, use the atoms directly. You give up the
template, transitions, and focus management; you keep the styled, accessible,
form-associated inputs.

```html
<form id="login">
  <zl-field name="email" label="Email" type="email" autocomplete="username" required></zl-field>
  <zl-submit action="submit" label="Continue"></zl-submit>
</form>
```

## Customisation tiers

| Tier | Surface | Use when |
| --- | --- | --- |
| Tokens only | `el.branding = {...}` | most tenants — colour, logo, font |
| CSS hooks | `zitadel-login::part(form)`, `zl-field::part(input)` | targeted overrides from the host page |
| Locale | `el.locale = { ... }` | i18n / custom copy |
| Custom transport | `el.transport = new ...()` | offline / staging / fixtures |
| Custom template | (planned) | tenant-supplied Liquid layouts |
| Atoms-only | hand-built form | non-standard flow shells |

The "Custom template" surface is not yet exposed on `<zitadel-login>`; the
orchestrator currently uses the bundled `auth_form.liquid`. Tracked as a
follow-up; the visualizer's Template tab is read-only when on the Real
components view to reflect this honestly.

## Element APIs

### `<zitadel-login>`

| Property | Type | Notes |
| --- | --- | --- |
| `purpose` | `'login' \| 'register' \| 'reset_password' \| string` | Which flow purpose to drive |
| `projectId` / `project-id` | `string` | Project / tenant id sent with `start` |
| `baseUrl` / `base-url` | `string` | Convenience for spinning up a `FetchTransport` |
| `transport` | `FlowTransport` | Use instead of `baseUrl` for fixtures / custom networks |
| `branding` | `Branding` | Tokens + assets; validated and mapped to CSS variables |
| `locale` | `Record<string, string>` | i18n dictionary consumed by Liquid's `\| t` filter |
| `issuer` | `string` | Optional discovery hint; passed through to the API |

`<zitadel-login>` also supports `::part(form)` and emits no public events
today (network responses are surfaced through transport callbacks).

### `<zl-field>`

Form-associated input. Participates in the parent `<form>`, supports validity
state, restores on form reset, and forwards Enter to `form.requestSubmit()`.

| Property | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Form key |
| `label` | `string` | Visible label (rendered above) |
| `type` | `'text' \| 'email' \| 'password' \| ...` | Native input type |
| `value` | `string` | Two-way bound; emits `zl-input` |
| `placeholder`, `autocomplete`, `pattern` | `string` | Forwarded |
| `required`, `disabled`, `invalid` | `boolean` | |
| `error` | `string` | Custom validity message |

Parts: `field`, `label`, `input`, `error`, `help`.

### `<zl-submit>` / `<zl-action>`

Primary submit button and secondary actions. Both emit `zl-action` events the
orchestrator listens for; in atoms-only setups you can listen for them yourself.

### `<zl-error>`

Region for step-level errors. Hidden when no `message` attribute and no slotted
content.

See [`src/atoms/`](src/atoms) for full TypeScript types and JSDoc.

## Project layout

```
packages/components/
├── dev/                   Vite playground (atoms + login routes; serves visualizer)
│   ├── index.html
│   ├── main.ts
│   ├── pages/             atom playground + <zitadel-login> demo
│   └── fixtures/          login flow fixture for the demo & visualizer
├── src/
│   ├── atoms/             zl-field, zl-submit, zl-action, zl-error + tests
│   ├── orchestrator/      <zitadel-login>, transport, liquid, sanitiser, branding
│   │   ├── locales/       bundled English fallback
│   │   └── templates/     bundled auth_form.liquid + default chrome
│   ├── tokens/            design-token catalogue + cssVar helpers
│   ├── styles/            shared host styles, focus ring
│   ├── manifests.ts       per-atom attribute / part / event manifests
│   └── index.ts           barrel
├── tsdown.config.ts       library build (externalises lit/liquidjs/dompurify)
├── vite.config.mts        dev server + visualizer alias
└── vitest.config.ts       jsdom (unit) + chromium (browser) projects
```

## Develop

```sh
# install once at the repo root
corepack pnpm install

# run the playground (atoms + login demo + visualizer)
corepack pnpm --filter @zitadel-nextgen/components dev
# → http://localhost:5174/             playground
# → http://localhost:5174/visualizer.html flow visualizer (real components)

# unit tests (jsdom)
corepack pnpm --filter @zitadel-nextgen/components test

# browser tests (real Chromium via Playwright; covers form-associated behaviour)
corepack pnpm --filter @zitadel-nextgen/components test:browser

# everything
corepack pnpm --filter @zitadel-nextgen/components test:all

# type-check
corepack pnpm --filter @zitadel-nextgen/components typecheck

# build the publishable bundle (ESM + .d.mts)
corepack pnpm --filter @zitadel-nextgen/components build
```

The dev server imports source TS straight from `src/` and hot-reloads on edits.
You only need to run `build` to test the published shape of the bundle.

## Testing strategy

Tests are split across two Vitest projects:

- **`unit`** — `jsdom`, fast feedback for rendering, Liquid wiring, branding
  validation, sanitiser allowlists, and DOM-level a11y attributes.
- **`browser`** — real Chromium via Playwright, covers behaviour `jsdom` can't
  fake: `ElementInternals` / form-associated state, native form submit
  interception, focus delegation across shadow roots.

Files ending in `.browser.spec.ts` run only in the browser project; everything
else runs in jsdom.

## Visualizer

`docs/design/flowengine/visualizer.html` is a static visualizer for the flow
API. The dev server aliases `/visualizer.html` to it and substitutes the
component bundle path with a `/@fs/` URL pointing at `src/index.ts`, so the
"Real components" tab mounts the live source — no build required.

```sh
corepack pnpm --filter @zitadel-nextgen/components dev
# open http://localhost:5174/visualizer.html
```

## Related design docs

- [`docs/design/branding/`](../../docs/design/branding/) — token spec, theme,
  template chrome, **and the form-participation ADR**.
- [`docs/design/flowengine/`](../../docs/design/flowengine/) — flow engine,
  step shape, template security, visualizer.

## License

MIT — see [LICENSE](../../LICENSE).
