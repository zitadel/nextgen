---
"@zitadel/sdk-core": patch
"@zitadel/sdk-qwik": patch
---

- `@zitadel/sdk-qwik` applied the widget config only imperatively, from a `ref` callback and a `useVisibleTask$`. Qwik resumes server-rendered markup instead of re-rendering it, so under SSR the `ref` never ran and the widget upgraded unconfigured ("requires a configured project", and a `login` flow on a register page) before the visible task re-bound it. The components now also emit their attribute-backed config declaratively — `project-id` / `proxy-path` / `url` (from the `project` handle or the discrete props), `purpose`, `post-sign-in-url`, `post-sign-out-url` and the rest — which Qwik serialises into the server-rendered HTML, so the widget is configured the instant it upgrades. Property-only config (the full `project` handle, `locales`) is still bound on the client.
- `@zitadel/sdk-core`'s `HOP_BY_HOP` set now includes `content-length`, so a proxy that re-sends a buffered body no longer forwards the client's value. undici computes the length itself and rejects a forwarded one with `UND_ERR_INVALID_ARG`, which surfaced as an opaque "fetch failed".
