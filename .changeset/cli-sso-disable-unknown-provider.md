---
"@zitadel/cli": patch
---

`zitadel auth-method sso disable --provider` now fails with `E_NOT_FOUND` for a provider that nothing offers, the catalog does not list and no connection under `.zitadel/idps/` names, such as a typo, and lists the providers and connections the project has, instead of reporting success.
