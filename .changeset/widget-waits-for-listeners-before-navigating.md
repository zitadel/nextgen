---
"@zitadel/components": patch
"@zitadel/sdk-core": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
---

The widgets now wait for their listeners before they navigate. The detail of `zitadel-flow-redirect`, `zitadel-flow-complete` and `zitadel-signout` carries a `waitUntil(promise)` function; the widget navigates once every promise a listener passed has settled, or after two seconds, and at once when none was passed. The React, Solid, Svelte and Qwik wrappers forward each callback's returned promise to `waitUntil`, so an async or lazily loaded handler runs before the page unloads; the Vue and Angular wrappers expose `waitUntil` on the event detail for a handler to call itself.
