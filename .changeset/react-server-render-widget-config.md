---
"@zitadel/sdk-react": patch
---

A server-rendered `ZitadelLogin`, `ZitadelSession` or `ZitadelLogout` now carries `purpose`, `flow-name`, `project-id`, `proxy-path`, `url` and `post-sign-out-url` as attributes in the server HTML, so the widget starts the right flow when the browser upgrades it, before React hydrates, instead of starting a `login` flow and restarting.
