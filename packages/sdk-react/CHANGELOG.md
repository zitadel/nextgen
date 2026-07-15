# @zitadel/sdk-react

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies [[`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999), [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65), [`a0b39a1`](https://github.com/zitadel/nextgen/commit/a0b39a119408a6fa02e8e1e45ebd5dd14b96c01b)]:
  - @zitadel/components@0.1.0-alpha.17
  - @zitadel/api@0.1.0-alpha.17
  - @zitadel/sdk-core@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- Updated dependencies [[`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2), [`754c7f6`](https://github.com/zitadel/nextgen/commit/754c7f6d8b970438a5ffa2c5c57ef72a2b5ed657), [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`bdf2906`](https://github.com/zitadel/nextgen/commit/bdf29064ab783f1d14ea554f3512bf243e86d3b5), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`69b6b6a`](https://github.com/zitadel/nextgen/commit/69b6b6a0fa934cbbd81deba46192b3b1346612a8)]:
  - @zitadel/components@0.1.0-alpha.16
  - @zitadel/sdk-core@0.1.0-alpha.16
  - @zitadel/api@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies [[`f45d47c`](https://github.com/zitadel/nextgen/commit/f45d47c5850edc83a55b5ad7364a59ffac4fd37c)]:
  - @zitadel/components@0.1.0-alpha.15
  - @zitadel/api@0.1.0-alpha.15
  - @zitadel/sdk-core@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#443](https://github.com/zitadel/nextgen/pull/443) [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630) Thanks [@bastionstack](https://github.com/bastionstack)! - Add a post-sign-in `<zitadel-session>` "signed in as" card: a dedicated element exposed through every SPA SDK and re-exported from sdk-next. CLI scaffolds now render it as the post-sign-in `/profile` page (with a Logout action) across all frameworks. Identity is read from `GET /sessions/me`, preferring `name` then `email` then `user_id`.

  `<zitadel-logout>` now sources its identity from the same `getMySession` operation instead of the `__nextgen_display` cookie, so both signed-in surfaces work against the real backend. Both components route their `getMySession`/`revokeMySession` calls through the shared `api-client` wrappers that enforce `credentials: "include"`.

### Patch Changes

- Updated dependencies [[`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b), [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007), [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630)]:
  - @zitadel/components@0.1.0-alpha.14
  - @zitadel/api@0.1.0-alpha.14
  - @zitadel/sdk-core@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies [[`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293)]:
  - @zitadel/api@0.1.0-alpha.13
  - @zitadel/components@0.1.0-alpha.13
  - @zitadel/sdk-core@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [[`2c32a90`](https://github.com/zitadel/nextgen/commit/2c32a90b41bdc7da736a2c3be0e8e851dbe59333), [`237c3c7`](https://github.com/zitadel/nextgen/commit/237c3c73a319e74c1411e3b04a1bb1a0e9d91051), [`a2f6526`](https://github.com/zitadel/nextgen/commit/a2f65266e00ee461e8e7fb1dee35e5add30b7199)]:
  - @zitadel/components@0.1.0-alpha.12
  - @zitadel/api@0.1.0-alpha.12
  - @zitadel/sdk-core@0.1.0-alpha.12

## 0.1.0-alpha.11

### Minor Changes

- [#285](https://github.com/zitadel/nextgen/pull/285) [`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6) Thanks [@mridang](https://github.com/mridang)! - Add Solid, Svelte and Qwik SPA SDKs that wrap the zitadel-login and zitadel-logout web components, mirroring sdk-react and sdk-vue. Every framework SDK now forwards the widget's five events (zitadel-flow-step, zitadel-flow-input, zitadel-flow-complete, zitadel-flow-error and zitadel-signout) as idiomatic callbacks, emits, or outputs that carry the typed event detail, with the shared detail types exported from @zitadel/sdk-core. All six framework SDKs build with Vite.

### Patch Changes

- Updated dependencies [[`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6), [`0b81768`](https://github.com/zitadel/nextgen/commit/0b8176857395d25c95343b5b320d074e0ba2c102), [`050f5d7`](https://github.com/zitadel/nextgen/commit/050f5d7a39a2a9160346276203e8da82db137478)]:
  - @zitadel/sdk-core@0.1.0-alpha.11
  - @zitadel/components@0.1.0-alpha.11
  - @zitadel/api@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies [[`acb5b54`](https://github.com/zitadel/nextgen/commit/acb5b549386efcc5ede005871b145c1cd0f9ac5e)]:
  - @zitadel/components@0.1.0-alpha.10
  - @zitadel/api@0.1.0-alpha.10
  - @zitadel/sdk-core@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9
  - @zitadel/components@0.1.0-alpha.9
  - @zitadel/sdk-core@0.1.0-alpha.9

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

- [#230](https://github.com/zitadel/nextgen/pull/230) [`52afa4f`](https://github.com/zitadel/nextgen/commit/52afa4fad509a7b3ff48ad262b6b0d9f975c5fe4) Thanks [@mridang](https://github.com/mridang)! - Add React, Vue and Angular SPA SDKs that wrap the zitadel-login / zitadel-logout web components, mirroring sdk-next and sdk-nuxt.
