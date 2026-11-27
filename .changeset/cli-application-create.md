---
"@zitadel/cli": minor
"@zitadel/server": patch
---

`zitadel application create` registers an Application and its first OIDC client through `POST /applications`. Pass `--name`, `--preset web|spa|native`, and at least one `--redirect-uri` (repeatable); interactive runs ask for anything missing. Credentials are always printed as a pasteable `.env` block (`ZITADEL_ISSUER`, `ZITADEL_CLIENT_ID`, `ZITADEL_CLIENT_SECRET` for web, `ZITADEL_CALLBACK_URL`); `--application-env-file` writes them to a file. The plural alias `zitadel applications create` works automatically.
