---
"@zitadel/cli": patch
"@zitadel/components": patch
"@zitadel/server": patch
---

`zitadel setup` now pins the dev-server port in the scaffolded `dev` script for Next and Nuxt, so the app serves the port setup registered as the project's allowed origin. Previously a bare `next dev` / `nuxt dev` ignored that port and defaulted to 3000 — and Next silently moved to 3001 when 3000 was busy — so login rendered but the first submit failed with `origin "http://localhost:3000" is not allowed for this project`. The other frameworks already pinned the port in their own dev-server config (Vite's `server.port` + `strictPort`, Angular's `serve.options.port`) and are unchanged. An explicit port also turns a busy port into a loud `EADDRINUSE` instead of a silent move to a rejected origin.

`doctor` verifies that dev script against the port recorded as the development issuer, so a script moved to another port is reported as an unapplied config edit and `doctor --fix` restores the registered port. `eject` now lists `package.json` among the edits it cannot auto-revert.

A login that cannot start — a rejected origin being the most common cause — now reports the failure inside the login card instead of leaving a bare line of text on an otherwise empty page.
