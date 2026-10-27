---
"@zitadel/server": minor
---

An unknown address or a failed sign-in callback now shows a page in Zitadel's design with a request ID, and the console's error screens share its layout. Programs get JSON: `404` `req.not_found`, or `405` `req.method_not_allowed` with `Allow`. `server.request_id_header` takes the request ID from a proxy's header, such as `x-vercel-id`; set it only behind a proxy that overwrites it.
