---
"@zitadel/server": patch
---

The server now mints claim and dashboard URLs from a dedicated `server.public_base` setting (env `NEXTGEN_SERVER_PUBLIC_BASE`, default `https://nextgen.zitadel.cloud`) instead of deriving them from the schema identity namespace. Deployments reachable at another origin — a local server most of all — set the new key and `zitadel claim` opens the right console instead of a dead `nextgen.com` address. A misconfigured base (query, fragment, userinfo, or a non-http(s) scheme) now fails at startup instead of leaking into every minted URL.
