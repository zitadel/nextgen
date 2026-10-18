---
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
---

Fix the Solid and Svelte `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` components leaving the `project` handle out of server-rendered pages. The server markup now carries `project-id`, `proxy-path` and `url` attributes, including the values from a `project` handle, which wins over the discrete props, so the widget is configured when the browser upgrades it, before hydration. The Svelte components also stop rendering the handle as `project="[object Object]"`. The Solid package now exports its preserved-JSX build under the `solid` condition and the Svelte package exports its uncompiled components under the `svelte` condition, so SolidStart and SvelteKit compile the widgets for the server instead of receiving client-only output.
