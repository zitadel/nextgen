# Branding object

**Status:** Shipped. **Parent:** [`README.md`](README.md). **Scope:** how the login component reads the branding object. Storage and the admin API are out of scope here.

**The contract is the OpenAPI source, not this file.** [`api/openapi/components/flows/branding.yaml`](../../../api/openapi/components/flows/branding.yaml) and the `branding-*.yaml` files beside it define every field, its accepted forms, and its limits. This note covers what the contract cannot say: how the fields reach the widget and what the component does with a payload at paint time.

## One shape, three places

The same object is:

- the request body of `POST /branding`, which publishes it as a new immutable revision ([`api/openapi/endpoints/branding/`](../../../api/openapi/endpoints/branding/));
- a read-only projection on flow responses, carrying the project's latest revision and falling back to the maintained defaults;
- the local `.zitadel/branding/` descriptor that `zitadel apply` publishes ([`templates.md`](templates.md) § Authoring workflow).

It is written through the Branding API or `zitadel apply`, never through the Flow API. Audience overrides on the app → team → project ladder are a later resolution-rule evolution ([ADR 040](../../adrs/040-tenant-login-templates-editable-config.md)).

Every field is optional. An omitted key takes the maintained default, so a revision carrying one colour is as valid as one carrying the whole object. [`branding.example.json`](branding.example.json) shows a full one.

## Fields

| Field | What it is | Contract |
| --- | --- | --- |
| `layout` | `centered` \| `split`. The component validates it and hands it to the template as `branding.layout`. The bundled default template does not read it, so it is not an appearance control. | [`branding.yaml`](../../../api/openapi/components/flows/branding.yaml) |
| `liquid_template` | LiquidJS template for the step. Structure only, no `<style>`. | [`branding.yaml`](../../../api/openapi/components/flows/branding.yaml), [`templates.md`](templates.md), [`validator.md`](validator.md) |
| `logo_url` | Single-mark fallback, used only when neither theme side names a mark. | [`branding.yaml`](../../../api/openapi/components/flows/branding.yaml) |
| `hero_url` | Hero image, for templates that reference it: revisions published from the split and hero designs. The bundled default template does not use it. | [`branding.yaml`](../../../api/openapi/components/flows/branding.yaml) |
| `theme` | `mode`, plus the `light` and `dark` sides, each with its own `logo_url` and `palette`. | [`branding-theme.yaml`](../../../api/openapi/components/flows/branding-theme.yaml), [`branding-theme-side.yaml`](../../../api/openapi/components/flows/branding-theme-side.yaml), [`branding-palette.yaml`](../../../api/openapi/components/flows/branding-palette.yaml), [`branding-color.yaml`](../../../api/openapi/components/flows/branding-color.yaml) |
| `typography` | `font_family`, `font_url`, `scale`. One face covers body and headings. | [`branding-typography.yaml`](../../../api/openapi/components/flows/branding-typography.yaml) |
| `shape` | `radius` (preset or integer pixels), `density`, `logo_scale`. Shared across theme sides. | [`branding-shape.yaml`](../../../api/openapi/components/flows/branding-shape.yaml) |

The appearance blocks (`theme`, `typography`, `shape`) are wire fields. The component re-exports their types from the generated API model (`packages/components/src/orchestrator/branding.ts`) rather than declaring its own. The one client-side addition is `attribution`, which belongs to the embedding and is not stored on a revision.

How each block becomes `--zl-*` values is in [`tokens.md`](tokens.md).

## Theme sides

Light and dark are independent surfaces. Neither inherits from the other: a palette key one side omits takes the maintained default for that side, and a side the revision does not publish is never used, whatever `mode` or the operating system asks for.

`mode` is one input among three. Resolution runs strongest first: the embedding page's `<zitadel-login theme="…">` property, then `theme.mode`, then a variant-derived default (`dark` for `variant="page"`, `auto` for the embeddable `variant="widget"`). The element wins because the page hosting the widget knows its own surface better than stored branding does, but it selects among the published sides only. A revision that publishes one side resolves to that side regardless.

A logo is pixels and is never recoloured, so each side carries its own `logo_url`. A side without one shows no mark, unless the top-level `logo_url` is the only one set.

## Asset URLs

Asset URLs are HTTPS. `logo_url`, `hero_url`, and the per-side `logo_url` may use canonical loopback HTTP (`localhost`, dotted-decimal `127.0.0.0/8`, or `[::1]`) for local development; the component keeps those URLs only while its embedding document also runs on loopback HTTP. `typography.font_url` is HTTPS-only.

Shape validation cannot tell a live asset from a dead one, and a well-formed URL that serves nothing renders as a 0×0 `<img>`. Two layers cover that, neither of them a gate: `zitadel plan` / `apply` probe the top-level `logo_url` and `hero_url` and warn (`apps/cli/src/lib/sync/asset-probe.ts`; the per-side marks and `typography.font_url` are not probed), and the component hides an asset whose load fails, restoring either the split designs' decorative placeholder or a shipped design's authored no-asset content (`packages/components/src/orchestrator/asset-fallback.ts`). Templates cannot do the latter themselves: DOMPurify strips inline `onerror` along with every other event handler, so the listener is orchestrator-side. The CLI probe only contacts public HTTPS destinations and validates every redirect; loopback, private, and internal targets stay inconclusive so repo config cannot make the planning host scan its own network.

`typography.font_url` loads in page mode only. The component must inject a font stylesheet at document level (a shadow-scoped `@font-face` never registers faces), and Zitadel does not inject a stylesheet into a document it does not own. An embedded widget applies `font_family` and leaves loading to the embedding page. See [ADR 025](../../adrs/025-default-brand-font-loading.md).

## No custom CSS

The object carries no CSS field. The [override ladder](override-ladder.md) covers CSS customization (tokens, host inline styles, `::part()`, eject), which avoids sandboxing arbitrary CSS and a schema field to maintain. Palette and font values are written into a stylesheet, which is why the contract pins their grammar ([`branding-color.yaml`](../../../api/openapi/components/flows/branding-color.yaml), [`branding-typography.yaml`](../../../api/openapi/components/flows/branding-typography.yaml)).

## Shape invariants enforced by the component

The server validates a revision on publish. The component checks the branding projection again each time a flow response arrives (`packages/components/src/orchestrator/branding-validator.ts`):

1. Every URL is HTTPS, except the logo and hero assets under the loopback rule above. The exception is dropped on non-loopback documents.
2. `layout` is one of the contract's values; anything else falls back to `centered`.

A failing field is dropped and reported as a console warning, and the widget renders with the maintained default in its place. A broken branding object degrades; it does not brick the widget.

## Where each check runs

| Check | Runs in |
| --- | --- |
| Field types, colour and font grammar, template size and banned patterns ([`../flowengine/template-security.md`](../flowengine/template-security.md)) | The server, on publish |
| The same template size and banned patterns, plus two the server cannot run: the template parses as LiquidJS and carries `{% mandatory_gates %}` (`@zitadel/config/template`) | The CLI, on `zitadel plan` / `apply` |
| URL and `layout` checks, as above | The component, per flow response |
| Output sanitising (DOMPurify) | The component, per render |

Nothing checks that a template renders every field and gate a step requires; the per-step structural pass in [`validator.md`](validator.md) is a design. The component parses and renders `liquid_template`, and a template that throws falls back to the bundled default. Three things keep a poor template usable at paint time:

1. **Render fallback**: a parse or render error renders the bundled default template for the step.
2. **Runtime safety net**: `{% mandatory_gates %}` appends any required field and the primary action the template left out, so the step stays submittable.
3. **Asset degradation**: an `<img>` that fails to load is hidden and, in the split designs, replaced by the decorative brand-pane placeholder. Armed per commit; a failure is warned about once on the console.

A revision published straight through the API skips the CLI's two extra checks, so these three are what it relies on.

## Contrast

The API validates each colour, not the pairs they form. Pair contrast is measured by `@zitadel/config/branding-contrast` and reported as warnings; it never blocks a publish.

## Open questions

- One `liquid_template` string per step, or a map keyed by purpose.
- `attribution` / powered-by: a branding field, server policy, or fixed.
- Where `locale` for `| t` comes from: branding, step payload, or host.
- Separate heading and mono faces, which `typography` does not model.
