# ADR 018: Widget-owned locale resolution

> **Status:** Accepted — 2026-05-29

## Context

The `<zitadel-login>` web component renders Liquid templates that contain
translatable text keys. Early iterations required the embedding application to
read the `Accept-Language` request header server-side, resolve a locale
dictionary, and pass it into the widget via a `locale` property. This created
three problems:

1. **Boilerplate in every host app** — each framework (Next.js, Nuxt, plain
   HTML) needed custom middleware or layout code to detect the language and
   wire it into the widget.
2. **Redundant server round-trip** — the browser already knows its preferred
   language via `navigator.language`, which mirrors the `Accept-Language`
   header the server receives.
3. **Tight coupling** — translation files shipped from `@zitadel/components`
   but had to be imported, resolved, and injected by application code.

## Decision

Language detection and locale resolution are the **widget's responsibility**.
The SDK middleware does **not** inject language headers or perform
server-side language detection.

### Widget API

The `<zitadel-login>` element exposes two properties:

| Property | Type | Purpose |
|---|---|---|
| `lang` | `string` | BCP 47 language tag (e.g. `"de"`, `"en-US"`). Overrides auto-detection. Inherited from `HTMLElement`. |
| `locales` | `Record<string, Locale>` | Custom locale dictionaries keyed by language code. Merged on top of built-in dictionaries. |

### Resolution chain

The private `resolveLocale()` method determines the effective dictionary:

1. Resolve the language code from (first non-empty wins):
   - `this.lang` attribute (explicit override)
   - `document.documentElement.lang` (`<html lang>` attribute)
   - `navigator.language` (browser preference)
2. Extract the primary subtag (e.g. `"de"` from `"de-AT"`).
3. If `this.locales[primary]` exists, **shallow-merge** it on top of the
   built-in dictionary: `{ ...builtin, ...custom }`. This allows partial
   overrides without importing the full base dictionary.
4. If no custom override exists, use the built-in dictionary directly.
5. Fall back to `en` if no built-in matches.

### Built-in locale registry

`packages/components/src/orchestrator/locales/index.ts` exports a
`builtinLocales` map (`{ en, de }`) and the individual dictionaries. New
languages are added by creating a `<code>.ts` file in the `locales/`
directory and registering it in the map.

### What the SDK does not do

The SDK middleware (`sdk-next`, `sdk-nuxt`) does not read `Accept-Language`,
does not set language headers, and does not provide a `detectLanguage`
configuration flag. `navigator.language` on the client provides the same
information without server involvement.

### When the server controls language

Applications that need server-controlled language (e.g. user profile language
preference stored in a database) can:

- Set `<html lang="de">` in their layout — the widget reads it automatically.
- Pass `lang="de"` directly on the element.
- Pass `locales={{ de: customDict }}` for custom translations.

This is inherently app-specific logic and does not belong in the SDK.

## Consequences

- **Zero-config i18n** — the widget detects the user's language from the
  browser without any application code.
- **Partial overrides** — apps can override individual translation keys
  without importing and spreading the full base dictionary.
- **SDK simplicity** — no language-related options, headers, or middleware
  logic in `sdk-next` or `sdk-nuxt`.
- **New languages** — adding a built-in language requires only a new file in
  `locales/` and a registry entry; no SDK or demo app changes needed.

## Related

- [`packages/components/src/orchestrator/locales/`](../../packages/components/src/orchestrator/locales/)
- [`packages/components/src/orchestrator/zitadel-login.ts`](../../packages/components/src/orchestrator/zitadel-login.ts)
- [ADR 006](./006-web-component-renderer-direction.md)
