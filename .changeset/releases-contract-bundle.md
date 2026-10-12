---
"@zitadel/server": minor
---

The API contract for `POST /releases` gains a `bundle` body, carrying the resources as authored on disk, as the alternative to `pointers`. A request carries exactly one of the two, and a top-level key the contract does not define is now refused with `req.invalid` instead of being ignored. The server does not build releases from bundles yet and answers a bundle with `rel.invalid`; `pointers` otherwise works as before.
