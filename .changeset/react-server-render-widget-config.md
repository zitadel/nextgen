---
"@zitadel/sdk-react": patch
---

A server-rendered `ZitadelLogin`, `ZitadelSession` or `ZitadelLogout` now carries `purpose`, `flow-name`, `project-id`, `proxy-path`, `url` and `post-sign-out-url` as attributes in the server HTML, so the widget starts the right flow when the browser upgrades it, before React hydrates, instead of starting a `login` flow and restarting. A `project` handle that carries a publishable key writes no project attributes, because attributes cannot carry the key and the widget would send its first request without it; that widget waits for the handle React binds at hydration.
