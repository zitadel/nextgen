# @zitadel/sdk-nuxt

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.8
  - @zitadel/components@0.1.0-alpha.8
  - @zitadel/sdk-core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.7
  - @zitadel/components@0.1.0-alpha.7
  - @zitadel/sdk-core@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies [[`30b4b41`](https://github.com/zitadel/nextgen/commit/30b4b411a9c99fc61d991f739636f93d7bee5b1d)]:
  - @zitadel/components@0.1.0-alpha.6
  - @zitadel/api@0.1.0-alpha.6
  - @zitadel/sdk-core@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- [#295](https://github.com/zitadel/nextgen/pull/295) [`f02718f`](https://github.com/zitadel/nextgen/commit/f02718f0499042569e13c1c67ae4135b6e943518) Thanks [@fforootd](https://github.com/fforootd)! - Allow fresh app scaffolding after `zitadel start` creates local runtime ignore files, and load Nuxt runtime config through the Nuxt virtual imports module.

- Updated dependencies [[`f77ca44`](https://github.com/zitadel/nextgen/commit/f77ca44e85565976d26de0b6444b7fc5b1616e8c), [`3795b67`](https://github.com/zitadel/nextgen/commit/3795b6793c72b92300fc6a7d21c7562f0a25343e)]:
  - @zitadel/components@0.1.0-alpha.5
  - @zitadel/api@0.1.0-alpha.5
  - @zitadel/sdk-core@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies [[`ce237ef`](https://github.com/zitadel/nextgen/commit/ce237ef355422c666769eef20df78bdc8ec0e0f9)]:
  - @zitadel/components@0.1.0-alpha.4
  - @zitadel/api@0.1.0-alpha.4
  - @zitadel/sdk-core@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.3
  - @zitadel/components@0.1.0-alpha.3
  - @zitadel/sdk-core@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [[`b0094f4`](https://github.com/zitadel/nextgen/commit/b0094f4255854c571664e746f70447c365c52af2), [`ce89c59`](https://github.com/zitadel/nextgen/commit/ce89c5941b4ae90849fac720ecc4a2a0c49c245d), [`01aed1e`](https://github.com/zitadel/nextgen/commit/01aed1e0de4ffd1ec6d78f8fa73f0ce19b907aa0), [`09aa2b1`](https://github.com/zitadel/nextgen/commit/09aa2b13da9dd0e15453f46f4d62fb2863835a0c), [`c097a5f`](https://github.com/zitadel/nextgen/commit/c097a5f0b720e58920c692ec909960e9c44696e3)]:
  - @zitadel/api@0.1.0-alpha.2
  - @zitadel/components@0.1.0-alpha.2
  - @zitadel/sdk-core@0.1.0-alpha.2

## 0.1.0-alpha.0

### Minor Changes

- [#209](https://github.com/zitadel/nextgen/pull/209) [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703) Thanks [@bastionstack](https://github.com/bastionstack)! - Rename the public packages to the `@zitadel` scope and publish them to npm via changesets with GitHub OIDC trusted publishing. This is the first `@zitadel/*`-scoped release line, cut as an `alpha` prerelease.

### Patch Changes

- [#73](https://github.com/zitadel/nextgen/pull/73) [`b118f74`](https://github.com/zitadel/nextgen/commit/b118f742cbd9e21cbb4616f36386f09f72a3cc69) Thanks [@bastionstack](https://github.com/bastionstack)! - Replace the `@nextgen/ui-lit` placeholder web components with the real
  `@zitadel/components` library across the demos and SDK packages.
  - Add `<zitadel-logout>`: an orchestrator-tier element built on the same
    design-token system as `<zitadel-login>`. It reads the `__nextgen_display`
    cookie, renders an avatar trigger + dropdown by default, and supports a
    `<template>`-slot mode with `{{name}}`, `{{email}}`, `{{initial}}`
    substitutions and `data-action="logout"` triggers. Fires `zitadel-signout`
    on completion.
  - Add `proxy-base` and `post-sign-in-url` attributes to `<zitadel-login>`.
    When `proxy-base` is set the orchestrator drives a new `ProxyTransport`
    against the SDK's `/__nextgen` proxy; `post-sign-in-url` navigates after a
    terminal step. `<zitadel-logout>` exposes `proxy-base` and
    `post-sign-out-url` for the symmetric flow.
  - Add `ProxyTransport`: a same-origin transport that speaks the
    `/v1/flow {action,email,password}` shape exposed by the
    `feat/sdk-packages` mock server / SDK proxy. Synthesises a single-step
    `FlowResponse` with `email` + `password` fields so the existing
    orchestrator + atom pipeline renders against it unchanged.
  - Drop the `@nextgen/ui-lit` package and switch `@zitadel/sdk-next`,
    `@zitadel/sdk-nuxt`, and the `apps/demo-next` / `apps/demo-nuxt` apps to
    re-export and consume `@zitadel/components` instead. Existing
    `<nextgen-login>` / `<nextgen-logout>` tags become `<zitadel-login>` /
    `<zitadel-logout>` with the same `proxy-base` and post-sign-{in,out}-url
    attributes.

- [#223](https://github.com/zitadel/nextgen/pull/223) [`8a8d417`](https://github.com/zitadel/nextgen/commit/8a8d417923754d58c3967839ebc9ebf84154531b) Thanks [@peintnermax](https://github.com/peintnermax)! - exchange auth header and form-associated name property

- Updated dependencies [[`5761ad2`](https://github.com/zitadel/nextgen/commit/5761ad2a2914d328203f5863b120e95300c60a22), [`c82ed55`](https://github.com/zitadel/nextgen/commit/c82ed5564e949bf8fe73f449db9a2718b50e7edf), [`0fa3fc9`](https://github.com/zitadel/nextgen/commit/0fa3fc9a5ec7f85f8d5ab771737e87decab8b404), [`b118f74`](https://github.com/zitadel/nextgen/commit/b118f742cbd9e21cbb4616f36386f09f72a3cc69), [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de), [`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba), [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de), [`8a8d417`](https://github.com/zitadel/nextgen/commit/8a8d417923754d58c3967839ebc9ebf84154531b), [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703)]:
  - @zitadel/sdk-core@0.1.0-alpha.0
  - @zitadel/components@0.1.0-alpha.0
  - @zitadel/api@0.1.0-alpha.0
