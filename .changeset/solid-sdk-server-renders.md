---
"@zitadel/sdk-solid": patch
---

The published Solid package now server-renders: it builds the widget element with Solid's `Dynamic` instead of DOM templates compiled at import time, so the same build runs in the browser and, resolved by your server bundler, renders to markup on Node and edge runtimes instead of throwing "Client-only API called on the server side".
