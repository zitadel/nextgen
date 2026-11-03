---
title: The login waits for your event handlers, and keeps secrets out of its events
summary: The login widgets now wait for the promises your handlers pass before they navigate, and no longer tell your listeners what a visitor types into a password or code field.
date: 2026-10-21T22:08Z
pulls: [2178, 2090]
---

The widgets now wait for their listeners before they navigate. The detail of `zitadel-flow-redirect`, `zitadel-flow-complete` and `zitadel-signout` carries a `waitUntil(promise)` function: the widget navigates once every promise a listener passed has settled, or after two seconds, and at once when none was passed. The React, Solid, Svelte and Qwik wrappers forward each callback's returned promise to `waitUntil`, so an async or lazily loaded handler runs before the page unloads; the Vue and Angular wrappers expose `waitUntil` on the event detail for a handler to call itself.

`<zitadel-login>` no longer dispatches `zitadel-flow-input` for a password or one-time-code field, so wiring `onFlowInput` to logging or analytics cannot capture what a visitor types there. Other fields dispatch as before.

[The login component](https://preview.zitadel.com/docs/sdks/components)
