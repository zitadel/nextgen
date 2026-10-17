---
"@zitadel/cli": patch
---

The development proxy that `zitadel setup` writes for React, Vue, Solid, Svelte, Qwik (in
`vite.config.*`) and Angular (`proxy.conf.cjs`) now keeps the session token out of the sign-in
exchange's answer even when Zitadel, or a CDN in front of it, compresses that answer. The proxy
asks for an uncompressed answer, decodes a gzip, deflate or Brotli one it gets anyway, and answers
`502` rather than pass on a body it cannot read. When the server drops the connection mid-answer,
the browser's request now fails instead of waiting forever. For an app set up earlier, run
`zitadel doctor --fix` to update the proxy in place; your other changes to the file are kept.
