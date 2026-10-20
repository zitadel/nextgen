---
"@zitadel/cli": patch
---

`zitadel setup` now creates new Next.js apps on Next.js 16.4.2 instead of 16.2.4. Next.js 16.2.4 has known advisories, among them a critical remote code execution and several ways around Middleware / Proxy, the layer `nextgenMiddleware` protects routes in. An app created by an earlier `zitadel setup` keeps the version it was created with: upgrade it with `npm install next@^16.4.2`.
