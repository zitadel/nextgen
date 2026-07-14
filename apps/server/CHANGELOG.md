# @zitadel/server

## 0.1.0-alpha.15

### Patch Changes

- [#488](https://github.com/zitadel/nextgen/pull/488) [`6e4a11a`](https://github.com/zitadel/nextgen/commit/6e4a11a7cd07587a51362d751fcc0320b00a4301) Thanks [@fforootd](https://github.com/fforootd)! - Unauthenticated requests to cookie-secured endpoints (`GET`/`DELETE /sessions/me`, `GET /users/me`) now return `401` with the stable code `auth.unauthorized` instead of `400 req.invalid`, matching the documented OpenAPI contract. API error responses no longer serialize internal diagnostics (`parent`, `location`) into `details`, and security errors return a normalized message instead of raw framework text.

## 0.1.0-alpha.14

### Minor Changes

- [#341](https://github.com/zitadel/nextgen/pull/341) [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold editable schema and flow config from shared local defaults, add project default seeding control, and seed sync state so plan is idempotent immediately after setup.

### Patch Changes

- [#456](https://github.com/zitadel/nextgen/pull/456) [`eedc8fe`](https://github.com/zitadel/nextgen/commit/eedc8fe94a850fb2c7173c0b782bcae9d30817a1) Thanks [@wim07101993](https://github.com/wim07101993)! - Add schema correlation via `objectType`: schemas now persist this field, and
  `GET /schemas` can filter by `objectType`.

- [#434](https://github.com/zitadel/nextgen/pull/434) [`ddc0c13`](https://github.com/zitadel/nextgen/commit/ddc0c1323ac7eac7332344931fe7c077857f70dc) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix passkey signup silently dropping every collected user attribute except the identifier. The passkey-register now routes user creation through `UserService`.

- [#453](https://github.com/zitadel/nextgen/pull/453) [`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b) Thanks [@vitorbari](https://github.com/vitorbari)! - Add back navigation to interactive flows. The engine injects a `back` action on rendered step responses when there's a step to return to, and clears the back stack past irreversible mutations (user creation, passkey registration) and at flow termination.

## 0.1.0-alpha.13

### Patch Changes

- [#411](https://github.com/zitadel/nextgen/pull/411) [`720e526`](https://github.com/zitadel/nextgen/commit/720e526f0f29181b1ae5824dee18cf57b10bea3f) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop the `x-password` user-property annotation. The flow engine sources the password challenge from the reserved `x-auth-methods#password` field name combined with `x-auth-methods.password.enabled` at the schema root (introduced in [#400](https://github.com/zitadel/nextgen/issues/400)); `x-password` is no longer read by any code path. Removed from the `user-property.json` meta-schema and the CLI's generated `password` preset; comments and docs updated to match.

- [#417](https://github.com/zitadel/nextgen/pull/417) [`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293) Thanks [@fforootd](https://github.com/fforootd)! - Label passkey registrations with collected identifiers and request discoverable credentials while keeping WebAuthn user handles opaque.

## 0.1.0-alpha.12

### Patch Changes

- [#336](https://github.com/zitadel/nextgen/pull/336) [`f6279a0`](https://github.com/zitadel/nextgen/commit/f6279a0bac51447533a4a33eb33479b792558783) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier outcomes (`user_not_found`, `user_already_exists`) now flip `CurrentPurpose` consistently across every dispatch path (including the passkey-issue path) and only when the routing transition is actually taken, preventing a phantom mode switch when no matching transition is wired.

- [#365](https://github.com/zitadel/nextgen/pull/365) [`9b05b82`](https://github.com/zitadel/nextgen/commit/9b05b82c3e7546ad3c4ebd4a025a991da499abf8) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier dispatch now re-runs `SubmitIdentifier` on every request and drops any in-flight ceremony when the resolved user changes. This unblocks a passkey-login failure where two users sharing a browser session could not both authenticate without a refresh — the previous user's id stayed cached in flow state and short-circuited the lookup for the next attempt.

- [#403](https://github.com/zitadel/nextgen/pull/403) [`2b2cfd5`](https://github.com/zitadel/nextgen/commit/2b2cfd58f63d564c96fdc582c07e874297a5229c) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow API: select-typed step fields now include their `validation.enum` in the response. The API mapper was dropping the resolver-derived enum, so clients rendering a `select` had no option values to display.

- [#400](https://github.com/zitadel/nextgen/pull/400) [`e5150f3`](https://github.com/zitadel/nextgen/commit/e5150f30dfc2b24230fa698bb99baeceb2841d00) Thanks [@wim07101993](https://github.com/wim07101993)! - Credentials are no longer modeled as user-schema properties — flow definitions reference them through `x-auth-methods` instead. A password field in a flow step is now `"x-auth-methods#password"`, sourced from the schema's `x-auth-methods` keyword, rather than a `password` user property carrying `x-password: true`.

- [#376](https://github.com/zitadel/nextgen/pull/376) [`5d18103`](https://github.com/zitadel/nextgen/commit/5d18103e677d31a5b9b7c93ea164bef53b3e6e96) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Fix the embedded hosted-login shell to call the Flow API on the same origin at `/flow`.

## 0.1.0-alpha.11

## 0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- [#325](https://github.com/zitadel/nextgen/pull/325) [`ae99992`](https://github.com/zitadel/nextgen/commit/ae999926df674eb7ca777e0273789b8f58f83a19) Thanks [@fforootd](https://github.com/fforootd)! - Forward normal shutdown signals from the npm server wrapper to the packaged Zitadel binary.

## 0.1.0-alpha.8

### Patch Changes

- [#319](https://github.com/zitadel/nextgen/pull/319) [`0547b8c`](https://github.com/zitadel/nextgen/commit/0547b8c397b1016e199fa16f0b208a7115720806) Thanks [@fforootd](https://github.com/fforootd)! - Cut a fresh alpha package train with the embedded UI release build fix.

## 0.1.0-alpha.7

### Patch Changes

- [#317](https://github.com/zitadel/nextgen/pull/317) [`0bacdf2`](https://github.com/zitadel/nextgen/commit/0bacdf23226a1e90c37f09b3cac245e1cf917091) Thanks [@fforootd](https://github.com/fforootd)! - Cut a fresh alpha package train after the release automation fixes.

## 0.1.0-alpha.6

### Minor Changes

- [#305](https://github.com/zitadel/nextgen/pull/305) [`2cf813e`](https://github.com/zitadel/nextgen/commit/2cf813e62d2d76346536911e3e4ccfe390fb3583) Thanks [@fforootd](https://github.com/fforootd)! - Publish the Zitadel server binary to npm through a wrapper package and platform-specific binary packages.
