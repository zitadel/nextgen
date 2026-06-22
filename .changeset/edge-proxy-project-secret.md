---
"@zitadel/edge-proxy": minor
---

`@zitadel/edge-proxy` now injects the project service-key. Pass `projectSecret` to `resolveConfig` and the handler attaches it as `Authorization: Bearer <secret>` on every proxied upstream request unless the request already carries an `Authorization` header. The secret is read from a server-side env var (`ZITADEL_PROJECT_SECRET`) inside the edge runtime and never reaches the browser, which is why a worker/edge function is required over a static rewrite rule. The Cloudflare, Vercel, and Netlify shims in `etc/` read the secret and pass it through.
