---
"@zitadel/cli": patch
---

React, Vue, Solid, Svelte, Qwik and Angular apps set up with `zitadel setup --server https://…` can now sign in through their dev proxy. The generated `/__nextgen` proxy sent the app's own `localhost` host name on to the server, and a remote https server refuses that connection; the proxy now addresses the server by its own name and passes the app's origin on in `X-Forwarded-Host` and `X-Forwarded-Proto`. In an app set up with an earlier version, `zitadel doctor` flags the dev proxy and `zitadel doctor --fix` updates it in place.
