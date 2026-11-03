---
"@zitadel/cli": patch
---

Every command now validates its flags and arguments before it runs, so a bad port, an excluded flag combination or a missing local server is refused with the same `E_VALIDATION` envelope up front; the wording of some refusals changed.
