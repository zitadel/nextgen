---
"@zitadel/api": minor
---

The API client now throws a typed error class for each error code the spec names, such as `ProjNotFoundError`, so a caller catches a failure by type instead of comparing code strings. Every class extends `ApiError`, and a code the client does not know still throws a plain `ApiError`.
