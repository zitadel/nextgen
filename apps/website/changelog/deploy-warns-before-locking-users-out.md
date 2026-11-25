---
title: zitadel deploy warns before it locks users out
summary: zitadel deploy and its dry run now warn when a config would leave existing users unable to sign in, and say which schema or flow the server rejected and why.
date: 2026-11-06T23:31Z
pulls: [2598, 2781, 2752, 2757, 2597]
---

`zitadel deploy` and `zitadel deploy --dry-run` now warn when the config would lock existing users out, naming the schema and counting the users it affects:

- users who lack the property a schema now signs in with (its `x-identifier`);
- users with an SSO link whose schema no flow uses any more;
- users who depend on a sign-in method the config disables, such as passkeys for users who signed up with only a passkey.

These checks only warn, and are skipped when the users cannot be read. `deploy` also warns when a login flow can finish without verifying a password, passkey or SSO sign-in.

Mistakes are caught earlier, and explained:

- The dry run and `zitadel doctor` refuse a user schema whose `x-auth-methods` holds a key that is not a sign-in method, such as a misspelt `pasword`, and suggest the method it was likely meant to be. Before, the dry run passed and the deploy failed with a generic error.
- When the server refuses a release, `deploy` prints which schema or flow it rejected and why, instead of only `release: invalid`. A schema that fails the meta-schema names the failing property path and keyword.
- `zitadel auth-method password|passkey|sso disable --dry-run` refuses to remove a schema's last way to sign in without `--force`, as the real run does.

[What deploy checks before it publishes](https://preview.zitadel.com/docs/guides/deploy#what-deploy-checks-before-it-publishes)
