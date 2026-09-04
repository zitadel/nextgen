# @zitadel/server-win32-x64

## 1.0.0-alpha.22

## 1.0.0-alpha.21

## 1.0.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- [#822](https://github.com/zitadel/nextgen/pull/822) [`41f6a0a`](https://github.com/zitadel/nextgen/commit/41f6a0a7c60e28a9adecfa9d72b964a305f7ba3d) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop `position` from `x-auth-methods` entries; `enabled` is now the only key. The
  user schema declares which authentication methods a user type supports.
  Presentation concerns such as the order methods are offered in belong to the flow
  engine, which takes them from the order of a step's actions in the flow
  definition.

  An auth-method entry now sets `additionalProperties: false`, matching the
  enclosing `x-auth-methods` object, which already rejects unknown method keys. A
  schema that still carries `position` fails validation instead of being accepted
  with the field ignored.

## 0.1.0-alpha.18

### Patch Changes

- [#404](https://github.com/zitadel/nextgen/pull/404) [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c) Thanks [@vitorbari](https://github.com/vitorbari)! - Flow engine: validate boolean and enum (select) user-schema fields at the flow step.

  The field validator now accepts a real JSON boolean for `checkbox` fields (and
  rejects a string), enforces a property's `const` (e.g. a must-accept terms
  checkbox pinned to `true`), and enforces `required` fields — both on the submit
  action and on the passkey-register issue leg. Previously these only failed later
  when `create_user` validated the user against the schema; a missing required
  field, an unticked must-accept box, or an unselected required dropdown now
  surfaces as a per-field step error instead.

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
