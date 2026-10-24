---
"@zitadel/server": minor
---

Errors now look and read the same wherever they appear. A browser that opens an address the server does not serve gets a "Page not found" page in Zitadel's design with a way on to the console, and a failed sign-in callback gets the same page; both show a request ID to quote to support. Programs keep getting JSON: an address no API operation answers now returns `404` with the code `req.not_found`, and a method an endpoint does not take returns `405` with `req.method_not_allowed` and an `Allow` header, where they used to get a plain-text or empty body. A request refused for a malformed path, query or header parameter now names that parameter in `details.fields`. The console's error and not-found screens follow the same layout, with a way on and the error code.

The new `server.request_id_header` setting names a header a proxy in front of the server sets to its own ID for each request, such as Vercel's `x-vercel-id`. The server then uses that ID in its logs, `X-Request-Id`, audit events and error pages, so the ID a person quotes finds the request in the proxy's logs too. Set it only behind a proxy that overwrites the header.
