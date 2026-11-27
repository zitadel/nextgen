---
"@zitadel/cli": minor
---

`zitadel application create --preset spa` and `--preset native` now register public OAuth clients (PKCE, no secret). Spa also requires `--origin` and prints `ZITADEL_ALLOWED_ORIGINS` in the pasteable credentials block.
