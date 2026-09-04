# @zitadel/testing

## 1.0.0-alpha.22

### Patch Changes

- Updated dependencies [[`82186ce`](https://github.com/zitadel/nextgen/commit/82186ce7da8dd96cd0f178a3a7c9994d7ee00cea), [`af21963`](https://github.com/zitadel/nextgen/commit/af21963a99d6f827699249fa524fbc64f2e6baab)]:
  - @zitadel/api@1.0.0-alpha.22
  - @zitadel/cli@1.0.0-alpha.22
  - @zitadel/config@1.0.0-alpha.22

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
