---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`zitadel auth-method password|passkey|sso disable --dry-run` now refuses to remove a schema's last way to sign in without `--force`, as the real run does, and `zitadel deploy` warns when a login flow can finish without verifying a password, passkey or SSO sign-in.
