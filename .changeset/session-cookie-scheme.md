---
"@zitadel/server": patch
---

The API document names its session cookie's security scheme `sessionCookie` instead of `nextgenSession`, as the [API reference](https://preview.zitadel.com/docs/reference/api) now shows it. The id never goes over the wire; a client you generate from the document gets the new name, such as `SessionCookie` for `NextgenSession`.
