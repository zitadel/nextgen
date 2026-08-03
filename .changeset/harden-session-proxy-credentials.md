---
"@zitadel/cli": patch
"@zitadel/server": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

Session-state reads now bypass caches and only canonical Zitadel 401/404 error
responses are treated as signed out, including expired or superseded session
cookies. The browser-only `getSession` helper and its options type now live on
the dedicated `@zitadel/sdk-next/session` entry instead of the package root.
Framework proxies attach the project secret only to the exact
`POST /sessions/exchange` handoff operation, so browser-reachable public and
management paths no longer receive an infrastructure-supplied operator
credential. After upgrading the CLI, run `zitadel doctor --fix` to migrate the
legacy managed Vite and Angular proxy hooks. Doctor warns when an unrecognized
proxy may still over-forward the project secret; custom proxy implementations
remain user-owned and must be reviewed manually.
