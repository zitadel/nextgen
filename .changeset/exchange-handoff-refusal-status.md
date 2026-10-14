---
"@zitadel/server": patch
"@zitadel/api": patch
---

The API reference for `POST /sessions/exchange` now matches what the server answers when a handoff token cannot be exchanged — unknown, already exchanged, or expired: `400` with the code `sess.invalid_handoff_token`. It listed a `410 Gone` response that the server never sent; that response is removed, along with the `ExchangeHandoff410` and `ExchangeHandoff410Details` types in `@zitadel/api`. Code that waited for a `410` should check for the `sess.invalid_handoff_token` code instead.
