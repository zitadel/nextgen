# @zitadel/sdk-svelte

## 0.1.0-alpha.11

### Minor Changes

- [#285](https://github.com/zitadel/nextgen/pull/285) [`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6) Thanks [@mridang](https://github.com/mridang)! - Add Solid, Svelte and Qwik SPA SDKs that wrap the zitadel-login and zitadel-logout web components, mirroring sdk-react and sdk-vue. Every framework SDK now forwards the widget's five events (zitadel-flow-step, zitadel-flow-input, zitadel-flow-complete, zitadel-flow-error and zitadel-signout) as idiomatic callbacks, emits, or outputs that carry the typed event detail, with the shared detail types exported from @zitadel/sdk-core. All six framework SDKs build with Vite.

### Patch Changes

- Updated dependencies [[`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6), [`0b81768`](https://github.com/zitadel/nextgen/commit/0b8176857395d25c95343b5b320d074e0ba2c102), [`050f5d7`](https://github.com/zitadel/nextgen/commit/050f5d7a39a2a9160346276203e8da82db137478)]:
  - @zitadel/sdk-core@0.1.0-alpha.11
  - @zitadel/components@0.1.0-alpha.11
  - @zitadel/api@0.1.0-alpha.11
