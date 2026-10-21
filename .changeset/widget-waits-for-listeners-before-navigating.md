---
"@zitadel/components": patch
"@zitadel/sdk-core": patch
"@zitadel/sdk-qwik": patch
---

The widgets now wait for their listeners before they navigate. The detail of `zitadel-flow-redirect`, `zitadel-flow-complete` and `zitadel-signout` carries a `waitUntil(promise)` function; the widget navigates once every promise a listener passed has settled, or after two seconds, and at once when none was passed. `@zitadel/sdk-qwik` passes the promise of its `onFlowRedirect$`, `onFlowComplete$` and `onSignout$` callbacks, so a lazily loaded callback runs before the page unloads.
