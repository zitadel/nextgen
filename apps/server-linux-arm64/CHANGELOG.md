# @zitadel/server-linux-arm64

## 0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- [#526](https://github.com/zitadel/nextgen/pull/526) [`62a7982`](https://github.com/zitadel/nextgen/commit/62a79824e9574eaad1f478ef3b6d51badb4d1355) Thanks [@wim07101993](https://github.com/wim07101993)! - Default password/secret hashing is now `argon2id` (RFC 9106 second recommended
  option: `time=3`, `memory=64 MiB`, `threads=4`) instead of bcrypt, per ADR 029.
  Bcrypt and legacy algorithms (scrypt, pbkdf2, sha2, md5, md5salted, phpass,
  drupal7, argon2) stay registered as verifiers, so pre-existing hashes keep
  validating and are transparently rehashed to argon2id on the next successful
  verification. Configure `password_hasher.hasher.algorithm` (and
  `password_hasher.verifiers`) to override — e.g. set `bcrypt` with `cost: 10` to
  keep the previous behavior.

## 0.1.0-alpha.15

## 0.1.0-alpha.14

### Patch Changes

- [#434](https://github.com/zitadel/nextgen/pull/434) [`ddc0c13`](https://github.com/zitadel/nextgen/commit/ddc0c1323ac7eac7332344931fe7c077857f70dc) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix passkey signup silently dropping every collected user attribute except the identifier. The passkey-register now routes user creation through `UserService`.

- [#453](https://github.com/zitadel/nextgen/pull/453) [`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b) Thanks [@vitorbari](https://github.com/vitorbari)! - Add back navigation to interactive flows. The engine injects a `back` action on rendered step responses when there's a step to return to, and clears the back stack past irreversible mutations (user creation, passkey registration) and at flow termination.

## 0.1.0-alpha.13

### Patch Changes

- [#411](https://github.com/zitadel/nextgen/pull/411) [`720e526`](https://github.com/zitadel/nextgen/commit/720e526f0f29181b1ae5824dee18cf57b10bea3f) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop the `x-password` user-property annotation. The flow engine sources the password challenge from the reserved `x-auth-methods#password` field name combined with `x-auth-methods.password.enabled` at the schema root (introduced in [#400](https://github.com/zitadel/nextgen/issues/400)); `x-password` is no longer read by any code path. Removed from the `user-property.json` meta-schema and the CLI's generated `password` preset; comments and docs updated to match.

## 0.1.0-alpha.12

### Patch Changes

- [#336](https://github.com/zitadel/nextgen/pull/336) [`f6279a0`](https://github.com/zitadel/nextgen/commit/f6279a0bac51447533a4a33eb33479b792558783) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier outcomes (`user_not_found`, `user_already_exists`) now flip `CurrentPurpose` consistently across every dispatch path (including the passkey-issue path) and only when the routing transition is actually taken, preventing a phantom mode switch when no matching transition is wired.

- [#365](https://github.com/zitadel/nextgen/pull/365) [`9b05b82`](https://github.com/zitadel/nextgen/commit/9b05b82c3e7546ad3c4ebd4a025a991da499abf8) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier dispatch now re-runs `SubmitIdentifier` on every request and drops any in-flight ceremony when the resolved user changes. This unblocks a passkey-login failure where two users sharing a browser session could not both authenticate without a refresh — the previous user's id stayed cached in flow state and short-circuited the lookup for the next attempt.

- [#403](https://github.com/zitadel/nextgen/pull/403) [`2b2cfd5`](https://github.com/zitadel/nextgen/commit/2b2cfd58f63d564c96fdc582c07e874297a5229c) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow API: select-typed step fields now include their `validation.enum` in the response. The API mapper was dropping the resolver-derived enum, so clients rendering a `select` had no option values to display.

- [#400](https://github.com/zitadel/nextgen/pull/400) [`e5150f3`](https://github.com/zitadel/nextgen/commit/e5150f30dfc2b24230fa698bb99baeceb2841d00) Thanks [@wim07101993](https://github.com/wim07101993)! - Credentials are no longer modeled as user-schema properties — flow definitions reference them through `x-auth-methods` instead. A password field in a flow step is now `"x-auth-methods#password"`, sourced from the schema's `x-auth-methods` keyword, rather than a `password` user property carrying `x-password: true`.

## 0.1.0-alpha.11

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- [#305](https://github.com/zitadel/nextgen/pull/305) [`2cf813e`](https://github.com/zitadel/nextgen/commit/2cf813e62d2d76346536911e3e4ccfe390fb3583) Thanks [@fforootd](https://github.com/fforootd)! - Publish the Zitadel server binary to npm through a wrapper package and platform-specific binary packages.
