---
"@zitadel/server": minor
---

An OIDC IdP connection can keep a Zitadel v4 callback URL in `oidc.redirect_uri`, so a provider migrated from v4 needs no new registration. The server serves `/ui/login/login/externalidp/callback` and `/idps/callback` on every host and sends each callback on to the app origin the sign-in started from. `nextgen migrate-v4 --v4-callback URL` (and `--v4-callback-for ID=URL`) sets it on migrated connections.
