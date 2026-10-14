---
"@zitadel/sdk-core": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-qwik-city": patch
---

Make the Zitadel widgets work end-to-end in a Qwik City app (SSR + resumability).

Three independent issues blocked the Qwik City journey, none of which surface in a client-only SPA:

- `@zitadel/sdk-qwik` applied the widget config only imperatively, from a `ref` callback and a `useVisibleTask$`. Qwik resumes server-rendered markup instead of re-rendering it, so under SSR the `ref` never ran and the widget upgraded unconfigured ("requires a configured project", and a `login` flow on a register page) before the visible task re-bound it. The components now also emit their attribute-backed config declaratively — `project-id` / `proxy-path` / `url` (from the `project` handle or the discrete props), `purpose`, `post-sign-in-url`, `post-sign-out-url` and the rest — which Qwik serialises into the SSR'd HTML, so the widget is configured the instant it upgrades. Property-only config (the full `project` handle, `locales`) is still bound on the client.
- `@zitadel/sdk-qwik-city` read `ZITADEL_URL` / `ZITADEL_PROJECT_SECRET` from `process.env` at factory time. It now reads them per request from Qwik City's `ev.env` (which carries `.env.local`), falling back to `process.env`, mirroring how SvelteKit reads `$env/dynamic/private`.
- `@zitadel/sdk-core` forwarded the client's `content-length` to the upstream `fetch`. Because the proxy re-sends a freshly buffered body, undici computes content-length itself and rejects a forwarded one with `UND_ERR_INVALID_ARG`, surfacing as an opaque "fetch failed". `content-length` is now stripped in the shared `HOP_BY_HOP` set, fixing the proxy across every meta-framework SDK.
