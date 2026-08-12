# @zitadel/testing

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
