---
"@zitadel/sdk-angular": patch
---

Fix a server-rendered, hydrated Angular app starting its widgets with no project. `ZitadelLoginComponent`, `ZitadelLogoutComponent` and `ZitadelSessionComponent` now also write `project-id`, `proxy-path` and `url` as attributes, including the values from a `project` handle, so the widget is configured when the browser upgrades it, before Angular hydrates.
