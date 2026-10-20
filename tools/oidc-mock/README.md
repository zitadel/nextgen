# oidc-mock

A test-only OpenID Connect provider for the journey e2e runner. It wraps the
example server of [zitadel/oidc](https://github.com/zitadel/oidc) with one
confidential client (basic auth; it accepts PKCE S256 and a nonce but does not
require PKCE) and the fixed accounts in `users.json` (password `journey-pass`,
verified email). It is a nested Go module and never a product dependency.

Environment: `PORT` (required), `REDIRECT_URI` (required, comma separated),
`USERS_FILE` (required), `CLIENT_ID` (default `journey`), `CLIENT_SECRET`
(default `journey-secret`). The issuer is `http://localhost:<PORT>/`.

`moon run oidc-mock:build` writes `dist/oidc-mock`. The journey runner
(`e2e/journey/scripts/run-local.mjs`) starts it for each framework lane and
registers the lane's callback `<app>/__nextgen/idp/mock-idp/callback`.
