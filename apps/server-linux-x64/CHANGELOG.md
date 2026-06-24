# @zitadel/server-linux-x64

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
