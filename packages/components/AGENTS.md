# Components Agent Notes

Scoped instructions for `packages/components/`. Read together with the
[root `AGENTS.md`](../../AGENTS.md).

## What's in here

Lit-based atoms (`<zl-*>`) and the `<zitadel-login>` orchestrator that drives
the auth flow API. The package is consumed by tenant pages directly and by the
`apps/console` shell. See [`README.md`](README.md) for the consumer-facing
docs.

## Source-level conventions

### Lit reactivity — always use `accessor`

All `@property` and `@state` declarations must use the `accessor` keyword:

```ts
@property() accessor name = "";
@state() private accessor hasHelp = false;
```

Plain class fields (`@property() name = "";`) shadow Lit's auto-generated
accessors when the build target is `es2022` or any toolchain that sets
`useDefineForClassFields: true` (Vite, tsdown, esbuild). Lit logs a console
error in dev mode and silently fails to detect changes in prod. The fix is
not "turn off the warning" — it is the `accessor` keyword.

### Atoms are form-associated by default

Every input atom (e.g. `<zl-field>`) must:

- declare `static formAssociated = true`,
- attach `ElementInternals` in the constructor,
- mirror its value via `internals.setFormValue()` and validity via
  `internals.setValidity()`,
- implement `formResetCallback` and `formStateRestoreCallback`,
- enable `delegatesFocus: true` on its shadow root.

This is what makes password managers, browser autofill, native form submission
and validation work through Shadow DOM. The decision is documented in
[`docs/design/branding/form-participation.md`](../../docs/design/branding/form-participation.md);
read that before touching `zl-field` or adding new input atoms.

`jsdom` only partially implements `ElementInternals`. Form-association tests
go in `*.browser.spec.ts` files (real Chromium); jsdom-friendly aria/markup
checks go in `*.spec.ts`.

### No `CSS.escape` in runtime code

`jsdom` 29 does not ship `CSS.escape`. Code that runs in tests must not rely
on it — query the DOM directly (`querySelectorAll` + `getAttribute` filtering)
rather than building attribute selectors with `CSS.escape(value)`.

### Templates are sanitised

Output from the Liquid pipeline is run through DOMPurify with an allowlist
built from `manifestRegistry`. When you add a new attribute or part to an atom,
update its manifest in `manifests.ts` so the sanitiser keeps it. Anything not
in the allowlist is silently stripped.

### Tokens, not magic values

Atom styles must consume design tokens through the `cssVar(...)` helper
(`src/tokens/css-var.ts`). New tokens go in `src/tokens/catalogue.ts`. The
orchestrator maps `branding` tokens to CSS variables on its own shadow root —
do not reach for inline styles in atoms.

### Comments

Comments explain *why*, not *what*. Skip comments like
`// increment counter` or `// import the module`. Useful comments call out
trade-offs, browser quirks, or constraints the code itself can't convey.

## Tests

Two Vitest projects, one config (`vitest.config.ts`):

- `unit` — `jsdom`. Default; what `pnpm test` runs.
- `browser` — Chromium via `@vitest/browser-playwright`. Run with
  `pnpm test:browser`. Tests in `*.browser.spec.ts` only.

Always cover form-associated behaviour, focus delegation, and Enter-to-submit
in the browser project. Anything markup-only (aria attributes, classes, slot
projection) belongs in the unit project for speed.

## Build

`tsdown.config.ts` produces ESM + `.d.mts` and externalises `lit`, `liquidjs`,
and `dompurify` so npm consumers dedupe with their own copies. Do not bundle
those in by default — that breaks shared instances and bloats the package.

## Don't

- Don't bypass Lit's render with manual `innerHTML` mutation. Use `unsafeHTML`
  inside a `render()` (the orchestrator already does this for Liquid output;
  atoms should never need it).
- Don't add a `template` accessor on `<zitadel-login>` casually — it changes
  the public surface. There is an open follow-up to do this properly with
  per-tenant template caching; coordinate before implementing.
- Don't ship a new atom without a manifest entry, a unit spec, a browser spec
  if it owns user input, and an entry in the orchestrator's sanitiser
  allowlist (which reads from `manifestRegistry` automatically — but verify
  with a spec).
