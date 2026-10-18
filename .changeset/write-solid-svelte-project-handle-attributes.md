---
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
---

Fix the Solid and Svelte `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` components leaving the `project` handle out of server-rendered pages. The server markup now carries `project-id`, `proxy-path` and `url` attributes, including the values from a `project` handle, which wins over the discrete props, so the widget is configured when the browser upgrades it, before hydration. The Svelte components also stop rendering the handle as `project="[object Object]"`.
