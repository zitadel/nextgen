---
title: Errors look the same everywhere, with a request ID to quote
summary: An unknown address or a failed sign-in callback shows a page in Zitadel's design with a request ID, and the console's error screens show the failed request's ID too.
date: 2026-10-24T15:45Z
cloud: true
pulls: [2299, 2301]
---

An unknown address or a failed sign-in callback now shows a page in Zitadel's design with a request ID, and the console's error screens share its layout. Programs get JSON: `404` `req.not_found`, or `405` `req.method_not_allowed` with `Allow`.

- The console's error screens show the failed request's ID instead of the error code, so a support request can quote it, and `ApiError` from `@zitadel/api` carries it as `requestId`.
- A not-found screen in the console names what is missing, such as "User not found", and leads back to its list.
- `server.request_id_header` takes the request ID from a proxy's header, such as `x-vercel-id`; set it only behind a proxy that overwrites it.
