# @zitadel/ui-react

Paired React implementations of the `@zitadel/components` Lit atoms. The
internal Zitadel console is a pure React app; rather than adapt the Lit elements
via `@lit/react` (which would drag a Lit runtime into every page), the console
imports these visually-identical React components.

## Visual contract

Both the Lit atoms and these paired React components consume the same CSS
variables from [`@zitadel/design-tokens`](../design-tokens/README.md).
The host app is expected to import the token sheet **once**:

```ts
import "@zitadel/design-tokens/css/tokens.css";
import "@zitadel/ui-react/styles.css";
```

Shared surface CSS lives in `@zitadel/shared-component-styles` (see
`pairs.json`). `ui-react/styles.css` only re-exports that barrel; edit surface
CSS there, not in this package.

If you use Tailwind v4, also import the generated `@theme` block so the
`bg-zl-color-…` / `rounded-zl-radius-…` utilities resolve:

```ts
import "@zitadel/design-tokens/css/tailwind.css";
```

## Available components

| React           | Lit atom              | Notes                                                                |
| ---             | ---                   | ---                                                                  |
| `<Button>`      | `<zl-button>`         | Hierarchies: `primary`, `secondary`, `text`                          |
| `<Checkbox>`    | `<zl-checkbox>`       | Optional `label`; form-associated; mirrors the shared `.zr-checkbox` surface |
| `<TextField>`   | `<zl-field>`          | Native React inputs; mirrors the design-token border / focus styles  |
| `<Alert>`       | `<zl-alert>`          | Severities: `error`, `success`, `warning`, `info`                    |
| `<Pill>`        | `<zl-pill>`           | Tones: `neutral`, `pink`, `purple`, `orange`, `success`              |
| `<Icon>`        | `<zl-icon>`           | Shares the same curated SVG set                                      |
| `<Card>`        | `<zl-card>`           | Auth-card surface; `header` / `footer` props                         |
| `<PageShell>`   | `<zl-page-shell>`     | Full-bleed dark chrome with centred body                             |

Each React component and its Lit counterpart appear as `React` / `Lit` stories
under `Atoms/<Name>` in [`apps/storybook`](../../apps/storybook/README.md);
`@storybook/addon-vitest` runs them as real-browser tests (render + a11y, plus a
`play` interaction on the React story — the only behavioural coverage for these
React pairs) so the two surfaces stay locked together.

## Status

Pre-release substrate. Only the surface needed for the four published Figma
screens (Sign In, Sign Up, Passkey upsell, Signed-in) is shipped here.
