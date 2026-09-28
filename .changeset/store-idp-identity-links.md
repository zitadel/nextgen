---
"@zitadel/server": patch
---

Add the `idp_identity_links` table and its statements. A link pins a provider subject on an IdP connection to a user, so the server can find the user again on the next sign-in through that provider. Nothing uses the table yet; the SSO callback work (#1035, #1037) will.
