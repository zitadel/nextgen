# @zitadel/testing

## 0.2.0

### Patch Changes

- [#2328](https://github.com/zitadel/nextgen/pull/2328) [`31ef6c1`](https://github.com/zitadel/nextgen/commit/31ef6c1ec87540b0ac5f7b54e6087c67aded32e1) - The packages no longer ship `.d.ts.map` files. They pointed at `src` files the packages do not publish, so an editor's go-to-definition already landed on the `.d.ts`; it still does.

- [#2308](https://github.com/zitadel/nextgen/pull/2308) [`bfdf226`](https://github.com/zitadel/nextgen/commit/bfdf22640561bf5fb7be2e6b3f91f659fa41b01d) - `withZitadel` now waits for the instance's `/readyz`, which answers once its database does, instead of `/healthz`, so a suite starts against an instance that can serve requests.
- Updated dependencies [[`5d164ad`](https://github.com/zitadel/nextgen/commit/5d164adc0c0bc6d03b66583e41416c5677842905), [`6392fe2`](https://github.com/zitadel/nextgen/commit/6392fe2ce79e9d0c1534a832af3dc356e65b1765), [`a7f9216`](https://github.com/zitadel/nextgen/commit/a7f9216f5602bdbbb0a1d78c0a897786adc242c0), [`2fcf14c`](https://github.com/zitadel/nextgen/commit/2fcf14c45610a664186ba6be87128432b16f2ac0), [`89bcfca`](https://github.com/zitadel/nextgen/commit/89bcfca7d347b96173fe370cc3433a64aeaad8bd), [`e7b7d61`](https://github.com/zitadel/nextgen/commit/e7b7d61c4b5fa3dc0f8d00f9d920009fe2cd81c5), [`76dc3be`](https://github.com/zitadel/nextgen/commit/76dc3be0e6475dc0efa37e7b4b4d47fad16fc9a9), [`76dc3be`](https://github.com/zitadel/nextgen/commit/76dc3be0e6475dc0efa37e7b4b4d47fad16fc9a9), [`5f49e7d`](https://github.com/zitadel/nextgen/commit/5f49e7dfbc98df76beb9b6a83299e162b307509e), [`2d78353`](https://github.com/zitadel/nextgen/commit/2d78353e4191d576d8d163d312ae78be0e6c4341), [`3c324b5`](https://github.com/zitadel/nextgen/commit/3c324b5ac1a228b5bc2051057f99de64f3acba89), [`08a369b`](https://github.com/zitadel/nextgen/commit/08a369b1b6e2218f284df5950bf65e5249091ea0), [`3494326`](https://github.com/zitadel/nextgen/commit/349432696841ece1e5186f912f66d317ef4480aa), [`5ab100f`](https://github.com/zitadel/nextgen/commit/5ab100fb56da55ece35f43ac442ade1ad2117219), [`f2660b2`](https://github.com/zitadel/nextgen/commit/f2660b2d0f5008bd11da45d85866cf5fb21d2e90), [`4d4e814`](https://github.com/zitadel/nextgen/commit/4d4e81400bb37674a4c7a765d1924ba09e3d41c2), [`44029c8`](https://github.com/zitadel/nextgen/commit/44029c80ce5267791f3f25014c4d9cf48b0654e0), [`bd0905d`](https://github.com/zitadel/nextgen/commit/bd0905d582fedab65979b193d2d8e49c55413054), [`0529137`](https://github.com/zitadel/nextgen/commit/05291373c78982cf31f8ee303101298db8ca1893), [`bfdf226`](https://github.com/zitadel/nextgen/commit/bfdf22640561bf5fb7be2e6b3f91f659fa41b01d), [`76dc3be`](https://github.com/zitadel/nextgen/commit/76dc3be0e6475dc0efa37e7b4b4d47fad16fc9a9), [`b8fb271`](https://github.com/zitadel/nextgen/commit/b8fb271bacc623010daedf8d2b019fba5b374171), [`53386a7`](https://github.com/zitadel/nextgen/commit/53386a7de897e2e0605495246231d42558b27e87), [`fedce7e`](https://github.com/zitadel/nextgen/commit/fedce7e399b15ebe9e1068e072f864f89ffb7bc8), [`db036a5`](https://github.com/zitadel/nextgen/commit/db036a50ad5ae80f7d7d5159ceaeecca4fb5992d), [`8e651ad`](https://github.com/zitadel/nextgen/commit/8e651adb02a98b392159801bc9e935d99e5e4148), [`c0e9b41`](https://github.com/zitadel/nextgen/commit/c0e9b417cc1814294ef337b1f9e0713553a54bd5), [`d41d1a6`](https://github.com/zitadel/nextgen/commit/d41d1a6a29b50dd77ee48e84d4eba5fe862c7f19), [`ad626b9`](https://github.com/zitadel/nextgen/commit/ad626b94fc28df60d412b610e694d9dcd768a4b3), [`bbe402b`](https://github.com/zitadel/nextgen/commit/bbe402bd62421f3e7f37dd5e8cfac9760e799b06), [`2ecde76`](https://github.com/zitadel/nextgen/commit/2ecde76e573c125fd86b7cf7b918619426b624bd), [`89a3471`](https://github.com/zitadel/nextgen/commit/89a34712236d2edc2deb6f482b56a636726956e3), [`33918fa`](https://github.com/zitadel/nextgen/commit/33918faa4ac9300e53d43bf99b55191ba2daa07f), [`5ea7fe4`](https://github.com/zitadel/nextgen/commit/5ea7fe4f9bcaa323c67d2cd347e53e9ba9048d02), [`c21caeb`](https://github.com/zitadel/nextgen/commit/c21caeb5e6c797d092a970129eb2238884d9c9f3), [`bd0905d`](https://github.com/zitadel/nextgen/commit/bd0905d582fedab65979b193d2d8e49c55413054), [`492ddf0`](https://github.com/zitadel/nextgen/commit/492ddf008f6786aa291c3d07c7fad8374bd4dea7), [`65e1b78`](https://github.com/zitadel/nextgen/commit/65e1b7834326cfdd82e366df33df026769bf07af), [`31ef6c1`](https://github.com/zitadel/nextgen/commit/31ef6c1ec87540b0ac5f7b54e6087c67aded32e1), [`d9803f3`](https://github.com/zitadel/nextgen/commit/d9803f30c548df68cb07b9571b33ce025969cee6)]:
  - @zitadel/cli@0.2.0
  - @zitadel/api@0.2.0
  - @zitadel/config@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [[`114c32c`](https://github.com/zitadel/nextgen/commit/114c32c4a86f7b05794528b889faad159d59bf3f), [`43b20ea`](https://github.com/zitadel/nextgen/commit/43b20ea687081da0b074b8dfa95deb82ce921d98), [`17523dc`](https://github.com/zitadel/nextgen/commit/17523dcf8e55d9d8a07f27a05c6597749f81ef9b), [`8ef9c49`](https://github.com/zitadel/nextgen/commit/8ef9c495c97188893fd8b879c524ce8e097fa52b), [`dedd93b`](https://github.com/zitadel/nextgen/commit/dedd93ba07e58108771019e70466e858b504c374), [`1653960`](https://github.com/zitadel/nextgen/commit/16539605bbdeadbcf4d8ac2bbfa7e3e16b1af557), [`9194819`](https://github.com/zitadel/nextgen/commit/919481901283c4dddc6ce32276439b47b53961e8), [`b44d6f9`](https://github.com/zitadel/nextgen/commit/b44d6f9aaf0e7b6c4fdf4579d28b1c69ea0456a1), [`b44d6f9`](https://github.com/zitadel/nextgen/commit/b44d6f9aaf0e7b6c4fdf4579d28b1c69ea0456a1), [`ab19e1e`](https://github.com/zitadel/nextgen/commit/ab19e1eb2b2cfcfe15000d8d97861d465a2d0c4b), [`831cb81`](https://github.com/zitadel/nextgen/commit/831cb81978e65f1b5d41b41330c31e9c43fd2030)]:
  - @zitadel/cli@0.1.0
  - @zitadel/api@0.1.0
  - @zitadel/config@0.1.0

## 1.0.0-alpha.28

### Minor Changes

- [#2071](https://github.com/zitadel/nextgen/pull/2071) [`fa301b9`](https://github.com/zitadel/nextgen/commit/fa301b96daf57512cef6ffb4eb60fdd49cff33e4) Thanks [@fforootd](https://github.com/fforootd)! - The server SDKs now keep each app's session in a cookie named after its
  project, `__nextgen_session_<project id>`, instead of the `__nextgen_session`
  cookie every project on a host shared. On `localhost`, signing in to an app no
  longer signs you out of the Console of `zitadel start` or of another app, and
  signing in to the Console no longer signs you out of your apps.

  The `/__nextgen` proxy renames the cookie Zitadel sets on its way to the
  browser, sends the app's cookie to Zitadel under Zitadel's name, and passes no
  other project's session cookie on. Users who signed in before the upgrade stay
  signed in: the first time the middleware, or the widgets' session check, finds
  that the old cookie holds a session of the app's project, the session is copied
  to the new cookie. The old cookie stays until the user next signs in or out
  through the app, since the Console may share the app's project; then the proxy
  clears it, and on sign-out ends its session too, so it cannot sign the user
  back in. A response that sets a session cookie is never stored by a shared
  cache (`Cache-Control: private, no-store`). With no project configured, the
  proxy passes cookies through unchanged.

  If your server-SDK app reads the session cookie itself, or its tests set it,
  use `sessionCookieName(projectId)` (from `@zitadel/sdk-core`, or from
  `@zitadel/testing` in tests) instead of `__nextgen_session` or
  `SESSION_COOKIE_NAME`: the app's session is no longer kept there.

  `@zitadel/testing` adds `sessionCookieName(projectId)`, the cookie a server-SDK
  app keeps its session in, and `authenticatedPage` now signs its browser context
  in under both names, so it works for SPAs and server-SDK apps alike.
  `SESSION_COOKIE_NAME` stays Zitadel's own name. `@zitadel/sdk-core` adds
  `sessionCookieName`, `proxySessionCookies`, `serializeSessionCookie` and
  `SESSION_COOKIE_CACHE_CONTROL`.

### Patch Changes

- [#2076](https://github.com/zitadel/nextgen/pull/2076) [`12b3226`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f) Thanks [@fforootd](https://github.com/fforootd)! - The server SDKs now count a session as signed in only when it belongs to the
  app's own project. A session of another project on the same server, such as a
  second app on the same host or the console of a local `zitadel start`, reads
  as signed out in `protectedRoutes`, `auth()` and `getAuth()`, and its cookie is
  left in place for the app it belongs to.

  The project comes from the new `projectId` middleware option, else
  `ZITADEL_PROJECT_ID`, else the framework's public project id variable
  (`NEXT_PUBLIC_`, `VITE_` or `PUBLIC_ZITADEL_PROJECT_ID`). `zitadel setup`
  already writes these to `.env.local`. A deployment that sets none of them must
  set `ZITADEL_PROJECT_ID`, or nobody is signed in. With `@zitadel/sdk-nuxt`, the
  public project id (`NUXT_PUBLIC_ZITADEL_PROJECT_ID`) decides unless
  `nextgen.projectId` names one, so a built server follows it at runtime. A JWT
  session token must name the project in its `aud` claim. `auth()` in
  `@zitadel/sdk-next` also takes the project of `configureZitadel()`; with
  `createProxy(config)`, pass the same project to `auth()` when it lives only in
  that handle.

  `GET /sessions/me` takes an optional `project_id` and answers a session of
  another project with `403 sess.project_mismatch`. The SDKs send it, and so do
  `getSession()` in `@zitadel/sdk-next`, `<zitadel-session>`, `<zitadel-logout>`
  and the console. `getSession()` takes the project from its `projectId` option,
  `configureZitadel()` or `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, and without one reads
  as signed out. Signing out with `<zitadel-logout>` or `<zitadel-session>` no
  longer ends another project's session. The `AGENTS.md` guidance that
  `zitadel setup` writes now tells agents to read the session this way.

  A Bearer token that is not this app's no longer decides what happens to the
  session cookie that came with it: the cookie is judged, and cleared only when
  the backend refuses it, on its own.

  In `@zitadel/api`, `getMySession()` now takes its query parameters first: call
  `getMySession(undefined, init)` where you called `getMySession(init)`. In
  `@zitadel/sdk-core`, `checkOpaqueSessionToken()` and
  `validateOpaqueSessionToken()` take the project id as a fourth argument, and
  `resolveSession()` is the one implementation of these rules behind every server
  SDK's middleware.

  The `@zitadel/sdk-next` middleware also no longer lets a session that has not
  finished signing in through `protectedRoutes`.

- Updated dependencies [[`0f4b901`](https://github.com/zitadel/nextgen/commit/0f4b901f60f2ed20bff71e321564d3b1fc187eab), [`d04f94b`](https://github.com/zitadel/nextgen/commit/d04f94b50061418b1dba90f3f8b8ddfa0dee9adf), [`d04f94b`](https://github.com/zitadel/nextgen/commit/d04f94b50061418b1dba90f3f8b8ddfa0dee9adf), [`122864a`](https://github.com/zitadel/nextgen/commit/122864a9a65bd637a42258da9aaadc65cf462548), [`21ac783`](https://github.com/zitadel/nextgen/commit/21ac783d40f0480d93aaea550eb938e8f98a96dd), [`4d63c44`](https://github.com/zitadel/nextgen/commit/4d63c44b4f60dd02382d28fbc2fcf5fd1046f065), [`3d80fcb`](https://github.com/zitadel/nextgen/commit/3d80fcba9cf55a6c19c31912451e67e6cfc5d980), [`b53ef49`](https://github.com/zitadel/nextgen/commit/b53ef494bce234fc3f1e54c6cb4bd0cf288423c5), [`7c3d3dc`](https://github.com/zitadel/nextgen/commit/7c3d3dc557c3be1626c732e61221e33a180e4718), [`628e101`](https://github.com/zitadel/nextgen/commit/628e101e5c254ab8bdaca830fc6e4acbd084b41e), [`12b3226`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f), [`adf6453`](https://github.com/zitadel/nextgen/commit/adf64530b8a647465ae80888fb52232d05107809), [`fa301b9`](https://github.com/zitadel/nextgen/commit/fa301b96daf57512cef6ffb4eb60fdd49cff33e4), [`f65cebe`](https://github.com/zitadel/nextgen/commit/f65cebe8142daaab33882a8ae22822a75bd94e6f), [`e90dade`](https://github.com/zitadel/nextgen/commit/e90dade940d52ce4827ed63d0171d0de68cf2959)]:
  - @zitadel/api@1.0.0-alpha.28
  - @zitadel/config@1.0.0-alpha.28
  - @zitadel/cli@1.0.0-alpha.28

## 1.0.0-alpha.27

### Patch Changes

- Updated dependencies [[`de6f94b`](https://github.com/zitadel/nextgen/commit/de6f94b608e6831b57a46555eaa9cac282b9a47d), [`67dac68`](https://github.com/zitadel/nextgen/commit/67dac68bff6059f8efe208870ecbbbf3fd786534), [`3f81a75`](https://github.com/zitadel/nextgen/commit/3f81a75352439fcccdeada4eac9173e42ca75ae2)]:
  - @zitadel/cli@1.0.0-alpha.27
  - @zitadel/api@1.0.0-alpha.27
  - @zitadel/config@1.0.0-alpha.27

## 1.0.0-alpha.26

### Minor Changes

- [#1630](https://github.com/zitadel/nextgen/pull/1630) [`3949dab`](https://github.com/zitadel/nextgen/commit/3949daba71747aa6590ef6d454df482329f3322b) Thanks [@peintnermax](https://github.com/peintnermax)! - feat: password fields in `<zitadel-login>` now have a show/hide button, as
  NIST SP 800-63B recommends. It is on by default; set `suppress-password-toggle`
  on the element (a `suppressPasswordToggle` prop on every framework wrapper) to
  hide it. The setting belongs to the embedding page and is not stored with the
  branding.

  The button replaces the clear button on password fields, so the field shows
  one icon. It sits in the tab order right after the input, so keyboard users
  can reach it, while a pointer click keeps focus in the field. A revealed
  field opts out of spellcheck and autocorrect, and it is hidden again on
  submit, form reset and step change. The widget applies the setting to its
  fields directly, so it also holds for ejected templates; it is not a
  `<zl-field>` attribute.

  `@zitadel/testing`: the flow helpers' label fallback (`flowField` with a
  `label`, used by `loginWithPassword` and `registerWithPassword`) now matches
  the field by its textbox role, so the toggle's "Show password" name never
  competes with the password field.

- [#1779](https://github.com/zitadel/nextgen/pull/1779) [`1740fad`](https://github.com/zitadel/nextgen/commit/1740fad3e2023c2e797c944c266c6fcc77858994) Thanks [@fforootd](https://github.com/fforootd)! - `identity()` is now its own export of `@zitadel/testing` and
  `@zitadel/testing/playwright`: an unused email and password for registration
  tests, also in suites that run without `withZitadel()` and so have no `seed`
  fixture. `SESSION_COOKIE_NAME` is now exported from
  `@zitadel/testing/playwright` too, so a Playwright spec takes everything from
  that one entry point.

### Patch Changes

- [#1683](https://github.com/zitadel/nextgen/pull/1683) [`28f70b1`](https://github.com/zitadel/nextgen/commit/28f70b141709d1fb398a50b91c63ffa7e35e3553) Thanks [@vitorbari](https://github.com/vitorbari)! - A flow definition names its user schema by `objectType` and runs against the project's newest revision of it. `POST /flow_definitions` still accepts a schema id and stores the `objectType` it names, so reading a definition back returns the `objectType`.

  The default login flows name `human-user`, and `getDefaultLoginFlow` no longer takes `userSchemaUrl`. `zitadel sso enable` finds a flow that names its schema by `objectType`, and the console links a flow to the revision it runs against.

- Updated dependencies [[`9d41590`](https://github.com/zitadel/nextgen/commit/9d41590a70cd2282eb8bda8b76cbb78638ee535a), [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`17f56de`](https://github.com/zitadel/nextgen/commit/17f56de60ea40128898b6142d93a22c6fc6f2acd), [`717ae39`](https://github.com/zitadel/nextgen/commit/717ae39f47a1f27383e0f4e09d2d32125d5d8f57), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d), [`717ae39`](https://github.com/zitadel/nextgen/commit/717ae39f47a1f27383e0f4e09d2d32125d5d8f57), [`234272a`](https://github.com/zitadel/nextgen/commit/234272af0566f77e6e595ae5e71b258ec0214a9f), [`c98df9c`](https://github.com/zitadel/nextgen/commit/c98df9c779cac941333ad7a6b361fcbde04cca7e), [`d0ba5da`](https://github.com/zitadel/nextgen/commit/d0ba5dad6f1acee3ccfe8f2d9a08793961dca166), [`0a0bf20`](https://github.com/zitadel/nextgen/commit/0a0bf20b8920dd31b29d4ece89da0dcbb6e271d6), [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`330c823`](https://github.com/zitadel/nextgen/commit/330c823f2a4a73a7356f5698b170e5ccf42503d4), [`30cec27`](https://github.com/zitadel/nextgen/commit/30cec278dd443a3a2139807e9ce7d9b196a1f521), [`fdf59ee`](https://github.com/zitadel/nextgen/commit/fdf59ee803bc0423b5b95d824f84ce8ed9b9cbcc), [`b7646e9`](https://github.com/zitadel/nextgen/commit/b7646e9f115dcecfc11ad932a053d7a20a8106e2), [`290dfe6`](https://github.com/zitadel/nextgen/commit/290dfe6f1c9b45d592e42703573a6acd5b16fa2a), [`78f51e4`](https://github.com/zitadel/nextgen/commit/78f51e4a8ca3637af590f141ae2f9fdc17225f98), [`0a0bf20`](https://github.com/zitadel/nextgen/commit/0a0bf20b8920dd31b29d4ece89da0dcbb6e271d6), [`09c36b2`](https://github.com/zitadel/nextgen/commit/09c36b2bb5677fdda19d674a18e53e909935c575), [`2790af4`](https://github.com/zitadel/nextgen/commit/2790af40d2f03e04bb4ea60dc124eea5e07f01c2), [`88112ee`](https://github.com/zitadel/nextgen/commit/88112eeece7c1f3594ef33cb939127fbd899350f), [`80042ba`](https://github.com/zitadel/nextgen/commit/80042ba5495a71fb41d8a5c6664a9e62cf9add00), [`3f55e42`](https://github.com/zitadel/nextgen/commit/3f55e42ec5a86f2a335b39639414faa2864e292c), [`097bf62`](https://github.com/zitadel/nextgen/commit/097bf62815fb524d5f37478911f0da4a7a9773e3), [`eef798c`](https://github.com/zitadel/nextgen/commit/eef798c54db423216548f076f71249c505086166), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d), [`8d4df8d`](https://github.com/zitadel/nextgen/commit/8d4df8d00bc0408af7d0917dfac1abafe73ebca3), [`ac0b6cc`](https://github.com/zitadel/nextgen/commit/ac0b6cc6f4b24802fc12ca0c2836859bd3843aa6), [`b4886f9`](https://github.com/zitadel/nextgen/commit/b4886f98de362ef6e80cb5e49a38e97daa2288b0), [`28f70b1`](https://github.com/zitadel/nextgen/commit/28f70b141709d1fb398a50b91c63ffa7e35e3553), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d), [`717ae39`](https://github.com/zitadel/nextgen/commit/717ae39f47a1f27383e0f4e09d2d32125d5d8f57), [`c9fd392`](https://github.com/zitadel/nextgen/commit/c9fd392b132d5fd54e4a6e909ffd82ac711f9ae8), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d), [`4a4132f`](https://github.com/zitadel/nextgen/commit/4a4132fd2dc13f3a833a7aa0ab1dd35ef9b8fd6b), [`44abdb8`](https://github.com/zitadel/nextgen/commit/44abdb8e827ce34d7aae8d620d43904b3142baf9), [`e607c71`](https://github.com/zitadel/nextgen/commit/e607c71acdf41b10d1bcb46fa1cc74549aff0a08), [`e49233f`](https://github.com/zitadel/nextgen/commit/e49233fd536fd1504242ff458a19af55d4d2a09e), [`3dfdfeb`](https://github.com/zitadel/nextgen/commit/3dfdfebba5d0ba022a3b4c5621f3a02a9ff8b9ba), [`70dae57`](https://github.com/zitadel/nextgen/commit/70dae57fd8b4256a6be18f69deb633676f25b923), [`36fbcb4`](https://github.com/zitadel/nextgen/commit/36fbcb4e5383a0d6764efc44e9ac6da4e5c8d596), [`a90d598`](https://github.com/zitadel/nextgen/commit/a90d598c4a047f077638f7dc002677eb576e10d3), [`717ae39`](https://github.com/zitadel/nextgen/commit/717ae39f47a1f27383e0f4e09d2d32125d5d8f57), [`a5e22a9`](https://github.com/zitadel/nextgen/commit/a5e22a99d91417a11dc3bf018aa06c4eab4dbdb0), [`9e1318b`](https://github.com/zitadel/nextgen/commit/9e1318b8eb004534f52593b09bfd5a11a3671eb6), [`717ae39`](https://github.com/zitadel/nextgen/commit/717ae39f47a1f27383e0f4e09d2d32125d5d8f57), [`aacf8d2`](https://github.com/zitadel/nextgen/commit/aacf8d26dba2ef94f18692d4cbe9d2c5009b511e), [`6fcc94c`](https://github.com/zitadel/nextgen/commit/6fcc94cab3fbf1f49d2bf559492cc6622afa8558), [`c205f49`](https://github.com/zitadel/nextgen/commit/c205f49fa0c6c0ea44407da6776cdb6e5dcfdfc9), [`5dbfb0a`](https://github.com/zitadel/nextgen/commit/5dbfb0ac190248326008531f1cdd67cc4527063a), [`8182584`](https://github.com/zitadel/nextgen/commit/8182584001fe2115851022e8f92e696db52ee8be), [`d794e13`](https://github.com/zitadel/nextgen/commit/d794e1337bf2d4bf03b022874c5661642fc45d71), [`fa6d231`](https://github.com/zitadel/nextgen/commit/fa6d231def73a8c6a0f622ba27078feeeeb2abfe), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d)]:
  - @zitadel/cli@1.0.0-alpha.26
  - @zitadel/api@1.0.0-alpha.26
  - @zitadel/config@1.0.0-alpha.26

## 1.0.0-alpha.25

### Patch Changes

- Updated dependencies [[`46a366f`](https://github.com/zitadel/nextgen/commit/46a366fabf688964b3a62158e6922902f0f0045b), [`4c07937`](https://github.com/zitadel/nextgen/commit/4c0793767753c765a1c84ffb2f93a7504f7522ef), [`3937a77`](https://github.com/zitadel/nextgen/commit/3937a7724380c0e59ff039e946053945a8e6475d), [`025acc6`](https://github.com/zitadel/nextgen/commit/025acc68028216d982d88771e372ef99aacf1d54), [`79527ed`](https://github.com/zitadel/nextgen/commit/79527edba346d39fd43502eb4357d3d19a77ad2d), [`4c07937`](https://github.com/zitadel/nextgen/commit/4c0793767753c765a1c84ffb2f93a7504f7522ef), [`8c08f48`](https://github.com/zitadel/nextgen/commit/8c08f4873fe468b0dabfb1b668f85a31c3f142f7), [`0ca8019`](https://github.com/zitadel/nextgen/commit/0ca80197fedb2755964617d9fe5f17e08b1cb95b), [`79527ed`](https://github.com/zitadel/nextgen/commit/79527edba346d39fd43502eb4357d3d19a77ad2d), [`6aca9bb`](https://github.com/zitadel/nextgen/commit/6aca9bb9afcb6e2b33f9e5e5cf5af6c1319d4fe1), [`6821cc6`](https://github.com/zitadel/nextgen/commit/6821cc62356ef75cce936907d203470f35cd1a9a), [`7f95a7b`](https://github.com/zitadel/nextgen/commit/7f95a7b8edb55d7f15c1192f4567a74ee0be7195), [`77369ca`](https://github.com/zitadel/nextgen/commit/77369ca215600478d8f56740406ce9f52cf09d00), [`7897a77`](https://github.com/zitadel/nextgen/commit/7897a77cd7963591827bf1427574f0bb0b2df827), [`faccf02`](https://github.com/zitadel/nextgen/commit/faccf02136ff713718e103b18d4128e5a665d02e), [`c363d18`](https://github.com/zitadel/nextgen/commit/c363d1809bf2b8032178ea04e031d50cc365f71b), [`67461ef`](https://github.com/zitadel/nextgen/commit/67461efbc0db36d4771af85f09cdc5219e49a5a5), [`790ce8e`](https://github.com/zitadel/nextgen/commit/790ce8eb90ba043574f5822216e88de89b5767c9), [`46a366f`](https://github.com/zitadel/nextgen/commit/46a366fabf688964b3a62158e6922902f0f0045b), [`b208b0c`](https://github.com/zitadel/nextgen/commit/b208b0c7635b7c146c0fa7294ead08c92eba6cd2), [`0269f56`](https://github.com/zitadel/nextgen/commit/0269f56e8299584b20e5815cf9b8d3c84ae65010), [`0269f56`](https://github.com/zitadel/nextgen/commit/0269f56e8299584b20e5815cf9b8d3c84ae65010), [`0269f56`](https://github.com/zitadel/nextgen/commit/0269f56e8299584b20e5815cf9b8d3c84ae65010), [`b44b907`](https://github.com/zitadel/nextgen/commit/b44b907bd50fd244440999b8386a79d132b58f1c)]:
  - @zitadel/cli@1.0.0-alpha.25
  - @zitadel/api@1.0.0-alpha.25
  - @zitadel/config@1.0.0-alpha.25

## 1.0.0-alpha.24

### Patch Changes

- Updated dependencies [[`6524178`](https://github.com/zitadel/nextgen/commit/6524178cc74251da3d454451fdef45063fabce86), [`91b1eb6`](https://github.com/zitadel/nextgen/commit/91b1eb653fc00633cf64e9d93c9edf73e3687933), [`1a05521`](https://github.com/zitadel/nextgen/commit/1a0552186fe99b0af17a5dc4ffed02ddf2b4c222), [`b633a22`](https://github.com/zitadel/nextgen/commit/b633a22c5d2ee8957255dff6b836caab36c676ce), [`4bea70a`](https://github.com/zitadel/nextgen/commit/4bea70a7244b44e62476e6dd2dc6b8e4a7bd1a45), [`0a82bb1`](https://github.com/zitadel/nextgen/commit/0a82bb1e66f5d66b7d256389fb503939563b8eaa), [`e61c854`](https://github.com/zitadel/nextgen/commit/e61c8545f06ce9ebe25e7f2e0d344cb6f8efb0d0), [`f2e81dd`](https://github.com/zitadel/nextgen/commit/f2e81dd84af7e47c06c084365dea983ee59a305b), [`7165d73`](https://github.com/zitadel/nextgen/commit/7165d73f8d13f8f4aac94858ee5e918b5700c773)]:
  - @zitadel/config@1.0.0-alpha.24
  - @zitadel/api@1.0.0-alpha.24
  - @zitadel/cli@1.0.0-alpha.24

## 1.0.0-alpha.23

### Patch Changes

- Updated dependencies [[`48351c4`](https://github.com/zitadel/nextgen/commit/48351c4fa3cc16429a3cfcee1bcd2ea290399ed6), [`3a10eb6`](https://github.com/zitadel/nextgen/commit/3a10eb61dd7e597ccd5b62d8a39453fb7645673e), [`f8c5a24`](https://github.com/zitadel/nextgen/commit/f8c5a24aa87015e722f2f6ecfb276b839d46f4de), [`40025fe`](https://github.com/zitadel/nextgen/commit/40025feb3d9a7154db7d1348043248dbd42f5d6c), [`1162dc9`](https://github.com/zitadel/nextgen/commit/1162dc91c274fcd96bf3dada5b474356242cc1b9), [`93cac33`](https://github.com/zitadel/nextgen/commit/93cac336402cae09a3e6dfb8622556d13794ab71), [`93cac33`](https://github.com/zitadel/nextgen/commit/93cac336402cae09a3e6dfb8622556d13794ab71), [`a41c594`](https://github.com/zitadel/nextgen/commit/a41c5949c38baf6e501d9809ddd00f6be0838093), [`116e037`](https://github.com/zitadel/nextgen/commit/116e037eda29800c43ac18a00b20525c48878173), [`24cecf1`](https://github.com/zitadel/nextgen/commit/24cecf15ac26ff35a566622185a494dbec50440a), [`1feea7d`](https://github.com/zitadel/nextgen/commit/1feea7d9fceb633a2011ddf706fc904e3a595b71), [`a5a9046`](https://github.com/zitadel/nextgen/commit/a5a9046058e0cb92fc3d95e87de3458b5f77af96), [`1162dc9`](https://github.com/zitadel/nextgen/commit/1162dc91c274fcd96bf3dada5b474356242cc1b9), [`583a8ed`](https://github.com/zitadel/nextgen/commit/583a8ed0c6142539539eb6e082de8dbfe11a3246), [`f118796`](https://github.com/zitadel/nextgen/commit/f118796f01af9e90be00f3313f1f9fc5ab407b4b), [`6c3f4a3`](https://github.com/zitadel/nextgen/commit/6c3f4a35e6466e9335ebb00b9943902faef8f2f8), [`84d1c4b`](https://github.com/zitadel/nextgen/commit/84d1c4b7dc636dc4439c0ee7a21eee8ecad44f36), [`205cef5`](https://github.com/zitadel/nextgen/commit/205cef525ee26250b652ee40f0b35622dc05caea), [`85fb5ab`](https://github.com/zitadel/nextgen/commit/85fb5abc1edd8699b86898e57d31c4938a6228a5), [`b0e0f02`](https://github.com/zitadel/nextgen/commit/b0e0f02ee5c3ad022695a04c8da36ef891289c0b), [`8fc4472`](https://github.com/zitadel/nextgen/commit/8fc44720d0b93f6d5450bff85cb8ed984712156a), [`c63a477`](https://github.com/zitadel/nextgen/commit/c63a4774039438c43385a2fb410ea914518d3f14), [`b70e520`](https://github.com/zitadel/nextgen/commit/b70e52035b433e7c3293c54be43352bb59e78dc2), [`ce3c67c`](https://github.com/zitadel/nextgen/commit/ce3c67c10b7ef7f20a30335fedb07325b6146cad), [`1162dc9`](https://github.com/zitadel/nextgen/commit/1162dc91c274fcd96bf3dada5b474356242cc1b9)]:
  - @zitadel/cli@1.0.0-alpha.23
  - @zitadel/api@1.0.0-alpha.23
  - @zitadel/config@1.0.0-alpha.23

## 1.0.0-alpha.22

### Patch Changes

- Updated dependencies [[`893364c`](https://github.com/zitadel/nextgen/commit/893364c538f8468114510bfbdaac5cc2966d6395), [`c7c737a`](https://github.com/zitadel/nextgen/commit/c7c737a32dd62368161db2ab90d93af800c07198), [`82186ce`](https://github.com/zitadel/nextgen/commit/82186ce7da8dd96cd0f178a3a7c9994d7ee00cea), [`af21963`](https://github.com/zitadel/nextgen/commit/af21963a99d6f827699249fa524fbc64f2e6baab)]:
  - @zitadel/cli@1.0.0-alpha.22
  - @zitadel/config@1.0.0-alpha.22
  - @zitadel/api@1.0.0-alpha.22

## 1.0.0-alpha.21

### Patch Changes

- Updated dependencies [[`a24ec4d`](https://github.com/zitadel/nextgen/commit/a24ec4daac1c265a1263697ffbd3744873069d9a), [`a59b288`](https://github.com/zitadel/nextgen/commit/a59b288e4e52a3274c1ab4b5e4c241f1083aac6b), [`7a06425`](https://github.com/zitadel/nextgen/commit/7a06425a1b30a448bf05da8d870bd4570d304060)]:
  - @zitadel/cli@1.0.0-alpha.21
  - @zitadel/api@1.0.0-alpha.21
  - @zitadel/config@1.0.0-alpha.21

## 1.0.0-alpha.20

### Minor Changes

- [#905](https://github.com/zitadel/nextgen/pull/905) [`401655b`](https://github.com/zitadel/nextgen/commit/401655b74305ef7ef7178549395378ddfb7c77fc) Thanks [@fforootd](https://github.com/fforootd)! - Boot-captured credentials are now a documented contract on the instance
  handle. `handle.projectSecret` and `handle.previewSecret` are captured the
  one time the server mints them at provisioning, and a new `handle.platform`
  slot reserves the upcoming platform-plane credentials (platform project id
  and publishable key) — fixtures written against it today won't churn when
  platform provisioning ships; until then the slot stays unset, and further
  platform credentials will join it as optional fields once their design
  lands. `AppEnvTemplate` now accepts only the handle's string fields, so
  mapping a structured field into an env var fails at compile time instead of
  at app boot, and handshake files reject malformed `platform` blocks on read
  with the offending field named.

### Patch Changes

- Updated dependencies [[`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b), [`0a9a5af`](https://github.com/zitadel/nextgen/commit/0a9a5afd0336382ca8ebef9c646f09acde2d7ada), [`4a8d546`](https://github.com/zitadel/nextgen/commit/4a8d546d8abd6902f2e19c50e8b980f91451bbfd), [`1ef3c32`](https://github.com/zitadel/nextgen/commit/1ef3c32fd6fa7091f2300fa9e210f43040dbd143), [`19fc783`](https://github.com/zitadel/nextgen/commit/19fc7835e23d04da9c458bda2fda39c4aa9dbc00), [`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b)]:
  - @zitadel/cli@1.0.0-alpha.20
  - @zitadel/config@1.0.0-alpha.20
  - @zitadel/api@1.0.0-alpha.20

## 0.1.0-alpha.19

### Minor Changes

- [#857](https://github.com/zitadel/nextgen/pull/857) [`009fd77`](https://github.com/zitadel/nextgen/commit/009fd774f7f59bf3cf319b9753ac81b17ac7c873) Thanks [@fforootd](https://github.com/fforootd)! - `withZitadel()` now accepts suites with no app server of their own: omit `app`
  and it generates only the instance entry, for tests that drive the surfaces
  the Zitadel binary serves itself (`/ui/console/`, `/ui/login/`). `appOrigin`
  must then be the instance's own local origin. Existing configs are unaffected.

  The `zitadel` worker fixture now waits for the handshake file instead of
  reading it once, and runs automatically for every worker: the instance's
  health endpoint answers before bootstrap finishes writing the handshake, a
  gap that app-less suites could hit — with `auto`, even tests that use no
  fixture start against the fully bootstrapped instance.

### Patch Changes

- [#856](https://github.com/zitadel/nextgen/pull/856) [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344) Thanks [@fforootd](https://github.com/fforootd)! - The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.

- [#858](https://github.com/zitadel/nextgen/pull/858) [`91738b9`](https://github.com/zitadel/nextgen/commit/91738b93e445fc3dd3731a04f76fb3de24436cdb) Thanks [@fforootd](https://github.com/fforootd)! - The embedded console and the test kit's `seedUser` follow the flat-by-id management contract: path-id operations (get/delete user, list passkeys, set password, get schema, get flow definition, get/update team) no longer send a `project_id` query parameter — the server resolves the scope from the resource id itself.

- Updated dependencies [[`c2888bd`](https://github.com/zitadel/nextgen/commit/c2888bdfd3c2a21fefd76a9b7fa80507d97cd88b), [`61a0eee`](https://github.com/zitadel/nextgen/commit/61a0eee0abb310a834d94b72a74f351035021be8), [`79f5ce1`](https://github.com/zitadel/nextgen/commit/79f5ce1db6b36baab85944a667072f1936880704), [`18ed11e`](https://github.com/zitadel/nextgen/commit/18ed11e03f33ef76c4bcf0f4814f9a5c7de6d640), [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344), [`41f6a0a`](https://github.com/zitadel/nextgen/commit/41f6a0a7c60e28a9adecfa9d72b964a305f7ba3d), [`ff6ab36`](https://github.com/zitadel/nextgen/commit/ff6ab36b69af5331dc3d10591789ba081757c68b), [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657), [`e26f376`](https://github.com/zitadel/nextgen/commit/e26f37617f5d3a3f92f00c07aad89a98ee9d754f), [`4e04e5f`](https://github.com/zitadel/nextgen/commit/4e04e5fb2a9585669b75d2b188b0966bfb23f4e7), [`9ef7096`](https://github.com/zitadel/nextgen/commit/9ef709667f1a6f7bd5126491bf4039a34a43a792), [`3818717`](https://github.com/zitadel/nextgen/commit/3818717d9fd079828b742adf6624955e80966308), [`fb05da1`](https://github.com/zitadel/nextgen/commit/fb05da12e35ed586ccd65aa767b8bb06f1f16ad8), [`f1049fd`](https://github.com/zitadel/nextgen/commit/f1049fd1b07086ffd070ecdd0b2d80958efd72f2), [`46e3bd7`](https://github.com/zitadel/nextgen/commit/46e3bd74a2f4000d620997500e119f2b7b1941de), [`37e9cb9`](https://github.com/zitadel/nextgen/commit/37e9cb903943d34eebadfb44457872892f296823), [`433f81c`](https://github.com/zitadel/nextgen/commit/433f81cffc3e3e8499c555aa45b2a45aa557916f)]:
  - @zitadel/config@0.1.0-alpha.19
  - @zitadel/cli@0.1.0-alpha.19
  - @zitadel/api@0.1.0-alpha.19

## 0.1.0-alpha.18

### Minor Changes

- [#692](https://github.com/zitadel/nextgen/pull/692) [`dba98cc`](https://github.com/zitadel/nextgen/commit/dba98cce811830e9d59a0279b39b233341e5e464) Thanks [@fforootd](https://github.com/fforootd)! - Publish `@zitadel/testing`, the test-kit for seeded ephemeral local Zitadel
  instances. `startLocalZitadel()` boots the real server (binary runtime +
  embedded Postgres, no Docker) from test code and bootstraps a project with the
  default login flow; `withZitadel()` generates the Playwright `webServer`
  entries that boot the instance and your app without wrapper scripts; the seed
  API mints password users per test (`seed.user()`), unused identities for
  registration specs (`seed.identity()`), and headless sessions so tests start
  past login (`seed.session()`, `authenticatedPage`). macOS/Linux; alpha, like
  the rest of the train.

- [#704](https://github.com/zitadel/nextgen/pull/704) [`f0bc6b4`](https://github.com/zitadel/nextgen/commit/f0bc6b4c12bb5ba9cf83df5ccbce9521ca5d0e45) Thanks [@fforootd](https://github.com/fforootd)! - Add login-flow ceremony helpers to the Playwright entry: `loginWithPassword`,
  `registerWithPassword`, `registerWithPasskey`, and `loginWithPasskey` drive
  the `<zitadel-login>` widget through complete auth journeys on its documented
  automation hooks (locale-independent testids, not translated texts), with
  `flowAction`/`flowField` and `clickFlowAction`/`fillFlowField` as
  locator-level escape hatches for custom flows. The ceremonies branch only on
  what the flow renders — extra registration fields via `profile` entries — and
  leave app-state assertions to the caller.

- [#697](https://github.com/zitadel/nextgen/pull/697) [`312baab`](https://github.com/zitadel/nextgen/commit/312baab883390f5c5063400363cf2e0bbd1e4f17) Thanks [@fforootd](https://github.com/fforootd)! - Add `enableVirtualPasskey(page)` and the on-demand `passkey` Playwright
  fixture to the test-kit: a CDP virtual authenticator (platform authenticator,
  discoverable credentials, automatic user presence) that lets tests complete
  real passkey registration and login ceremonies headlessly, plus
  `credentialCount()` for asserting credential reuse. Chromium projects only,
  and the app under test needs an origin WebAuthn accepts as a relying-party
  ID: HTTPS, or `http://localhost` for local tests — raw IP origins are
  invalid.

### Patch Changes

- [#715](https://github.com/zitadel/nextgen/pull/715) [`cd99b80`](https://github.com/zitadel/nextgen/commit/cd99b80e865679a26b5541d0f142508b8fa87eaa) Thanks [@fforootd](https://github.com/fforootd)! - Escape control characters in flow action names before CSS attribute-selector
  interpolation, following the CSSOM string-serialization rules. Previously only
  quotes and backslashes were escaped, so an action name containing a newline or
  other control character could invalidate `flowAction`'s whole selector union.
- Updated dependencies [[`5208d86`](https://github.com/zitadel/nextgen/commit/5208d863015f78c9618317398ceda1e959c13296), [`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602), [`a1d01cd`](https://github.com/zitadel/nextgen/commit/a1d01cd1f384515929216ae019658b30dae91504), [`48effc9`](https://github.com/zitadel/nextgen/commit/48effc9e728dbe11ce45efe6572fe5da48ee0465), [`ff66683`](https://github.com/zitadel/nextgen/commit/ff66683eeb0daa3a12e7d11fed01076ac8c2ba58), [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde), [`e80bfb3`](https://github.com/zitadel/nextgen/commit/e80bfb34d3e9d2332eb2424dc8537f42b48c3ad8), [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a), [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f), [`9eaa610`](https://github.com/zitadel/nextgen/commit/9eaa61022101b4af1fa8bac77864fee22486c2f7), [`b37f23b`](https://github.com/zitadel/nextgen/commit/b37f23bc68cce7ba2ed0f0c2aac081de73f1c70d), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8), [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29), [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13), [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2), [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785), [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a), [`121e227`](https://github.com/zitadel/nextgen/commit/121e22776713f8972d2967f7b23c404c93f659c0), [`418457f`](https://github.com/zitadel/nextgen/commit/418457f7407c712f3ff02b30df014fbf12e03d23), [`1348cca`](https://github.com/zitadel/nextgen/commit/1348ccacaf1ecee056c9a6c7b9b9543ad1e2fdc1), [`77220eb`](https://github.com/zitadel/nextgen/commit/77220ebca4c81e78a1b43e103d3405f2acb5a10a), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`1395911`](https://github.com/zitadel/nextgen/commit/1395911519a40ceb4e06e8b68729376553d2768d), [`cb42772`](https://github.com/zitadel/nextgen/commit/cb427725b28a650739c5c86e72187f3df1529570), [`560ebf0`](https://github.com/zitadel/nextgen/commit/560ebf0b8a50bf378a4e011343f43ff3688a3efe), [`612c2e7`](https://github.com/zitadel/nextgen/commit/612c2e7e8343f6c12e6d7354374b3446c1b5c182), [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406), [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80), [`53d46fe`](https://github.com/zitadel/nextgen/commit/53d46fe3df8f93184e05582f934ecfc26d282564), [`2cf426e`](https://github.com/zitadel/nextgen/commit/2cf426e0bbe9d27059d748f16272bd1674408dc0), [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c)]:
  - @zitadel/cli@0.1.0-alpha.18
  - @zitadel/api@0.1.0-alpha.18
  - @zitadel/config@0.1.0-alpha.18
