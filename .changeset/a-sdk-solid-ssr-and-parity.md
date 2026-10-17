---
"@zitadel/sdk-solid": major
---

Importing `@zitadel/sdk-solid` in a SolidStart route no longer crashes server rendering: the
package ships a `solid` export condition so `vite-plugin-solid` compiles it for the server and
the hydrating client. `ZitadelLogin` and `ZitadelLogout` now render their children, so `<ZitadelLogout>` accepts a
`<template>` for a custom menu and `<ZitadelLogin>` accepts `attribution-trailing` slot content.
Clearing a prop back to `undefined` restores the element's default. The `zitadel-*` JSX element
types include `url`, `resume-flow-id`, the preview attributes and a typed `purpose`. The `solid-js`
peer range is now `^1.8.0`: upgrade an app on Solid below 1.8 before updating.
