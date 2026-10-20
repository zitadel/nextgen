---
"@zitadel/cli": patch
---

A server `zitadel start` runs can now sign users in through an identity provider on this machine, such as a test provider on `http://localhost:9400`. `start` passes `NEXTGEN_HTTPCLIENT_ALLOW_LIST=localhost,127.0.0.0/8,::1/128` to the server unless `.env.local`, `.env` or the shell sets it; set it empty to turn it off. `auth-method sso enable` no longer warns about a localhost issuer on such a server, and on a `--runtime docker` server it warns that the container cannot reach this machine's localhost.
