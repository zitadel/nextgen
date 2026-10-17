---
"@zitadel/cli": patch
---

The development proxy that `zitadel setup` writes for React, Vue, Solid, Svelte, Qwik (in
`vite.config.*`) and Angular (`proxy.conf.cjs`) no longer hands the session token to the page's
scripts. Zitadel answers the sign-in exchange with the session token in the response body as well
as in the HttpOnly session cookie, and the proxy passed that body to the browser as it was. It now
drops `session_token` from that one answer and keeps everything else, including the cookie; every
other call streams through unchanged. For an app set up earlier, run `zitadel doctor --fix`: it
reports the proxy and adds the redaction in place, keeping your other changes to the file. A
proxy entry you have rewritten by hand is left alone, so drop `session_token` from the
`POST /sessions/exchange` response there yourself.
