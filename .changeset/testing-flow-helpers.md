---
"@zitadel/testing": minor
---

Add login-flow ceremony helpers to the Playwright entry: `loginWithPassword`,
`registerWithPassword`, `registerWithPasskey`, and `loginWithPasskey` drive
the `<zitadel-login>` widget through complete auth journeys on its documented
automation hooks (locale-independent testids, not translated texts), with
`flowAction`/`flowField` and `clickFlowAction`/`fillFlowField` as
locator-level escape hatches for custom flows. The ceremonies branch only on
what the flow renders — extra registration fields via `profile` entries — and
leave app-state assertions to the caller.
