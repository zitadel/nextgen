---
"@zitadel/sdk-core": patch
"@zitadel/api": patch
"@zitadel/cli": patch
---

Fix sign-in behind a compressing edge failing with "got no response" after a successful exchange: the SDK proxies no longer forward `content-encoding` for a body `fetch` has already decoded, nor the browser's `accept-encoding`. A response whose body cannot be read now fails as a `NetworkError` with reason `unreadable` and says which status arrived, instead of claiming the server never answered.
