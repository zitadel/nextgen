---
"@zitadel/sdk-core": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-qwik-city": patch
---

Make the Zitadel widgets work end-to-end in a Qwik City app (SSR + resumability).

Three independent issues blocked the Qwik City journey, none of which surface in a client-only SPA:

- `@zitadel/sdk-qwik` bound the project config only as the `project` object *property*. Qwik does not re-apply object DOM properties to a custom element on resume, so after hydration the element booted unconfigured ("requires a configured project"). The component now also emits the declarative `project-id` / `proxy-path` / `url` attributes (derived from the same `project` handle), which Qwik serialises into the SSR'd HTML and Lit reflects onto the element the instant it upgrades — no resume race. The handle is still bound as the `project` property, now guarded to the browser because Qwik runs `ref` during SSR where the element is non-extensible.
- `@zitadel/sdk-qwik-city` read `ZITADEL_URL` / `ZITADEL_PROJECT_SECRET` from `process.env` at factory time. It now reads them per request from Qwik City's `ev.env` (which carries `.env.local`), falling back to `process.env`, mirroring how SvelteKit reads `$env/dynamic/private`.
- `@zitadel/sdk-core` forwarded the client's `content-length` to the upstream `fetch`. Because the proxy re-sends a freshly buffered body, undici computes content-length itself and rejects a forwarded one with `UND_ERR_INVALID_ARG`, surfacing as an opaque "fetch failed". `content-length` is now stripped in the shared `HOP_BY_HOP` set, fixing the proxy across every meta-framework SDK.
