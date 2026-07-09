# @zitadel/config

## 0.1.0-alpha.15

### Patch Changes

- [#485](https://github.com/zitadel/nextgen/pull/485) [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e) Thanks [@fforootd](https://github.com/fforootd)! - `apply` now re-pins flows to a freshly published schema revision in the same
  run: the CLI rewrites `user_schema` in every local flow file pinned to the
  superseded revision (lockfile-style, announced by `plan` and reported in the
  output) and the flow update carries the new id — editing a schema and using
  the new field in a flow no longer fails validation or needs a second apply.
  Interrupted runs recover via a `previousId` marker in `.zitadel/state.json`.

- [#482](https://github.com/zitadel/nextgen/pull/482) [`f52841d`](https://github.com/zitadel/nextgen/commit/f52841df9c1d5da857c2ff48d50a894c66fbcb5b) Thanks [@vitorbari](https://github.com/vitorbari)! - Improve the generated `.zitadel/schemas/README.md` guidance for editing user schemas and matching login flows.

- [#485](https://github.com/zitadel/nextgen/pull/485) [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e) Thanks [@fforootd](https://github.com/fforootd)! - Make `plan` diffs trustworthy and keep local config in lockstep with live
  state. `@zitadel/config/normalize` is the shared canonical-form normalizer
  (drops the server's empty `audience` echo and spelled-out `x-*` meta-schema
  property defaults); the sync engine hashes and diffs in normalized form
  (with a legacy-hash fallback so existing state files don't read as edits),
  and setup/apply write the server's canonical body back to the local file —
  reported in human and `--json` output — so a one-field edit renders as a
  one-field diff and applying can no longer silently strip live settings.
  The api-mock now mirrors the server's unconditional `audience` echo.

- [#485](https://github.com/zitadel/nextgen/pull/485) [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e) Thanks [@fforootd](https://github.com/fforootd)! - Surface the customize loop after setup: the "Zitadel is ready" next steps now
  point at the editable `.zitadel/schemas/` and `.zitadel/flows/` files and the
  `plan`/`apply` commands, and the scaffolded READMEs are restructured
  workflow-first (mental model → example → making changes → common changes).
- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#341](https://github.com/zitadel/nextgen/pull/341) [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold editable schema and flow config from shared local defaults, add project default seeding control, and seed sync state so plan is idempotent immediately after setup.

### Patch Changes

- Updated dependencies [[`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007)]:
  - @zitadel/api@0.1.0-alpha.14
