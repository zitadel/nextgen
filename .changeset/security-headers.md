---
"@zitadel/server": minor
---

The server sends security headers with every response: `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and policies that let no other site frame its pages. The console runs under a Content-Security-Policy that allows only its own scripts; browsers report violations to `/csp-report`, which the server logs. A page that framed the console no longer can.
