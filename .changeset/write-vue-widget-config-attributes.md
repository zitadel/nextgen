---
"@zitadel/sdk-vue": patch
---

Fix the Vue `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` components writing their configuration into server-rendered pages under names the widget never reads. The server markup now carries `project-id`, `proxy-path` and `url` attributes, including the values from a `project` handle, so the widget is configured when the browser upgrades it, before Vue hydrates.
