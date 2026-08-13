---
"@zitadel/cli": patch
---

`zitadel setup` now pins the dev-server port in the scaffolded `dev` script for Next and Nuxt, so the app serves the port setup registered as the project's allowed origin. Previously a bare `next dev` / `nuxt dev` ignored that port and defaulted to 3000 — and Next silently moved to 3001 when 3000 was busy — so login rendered but the first submit failed with `origin "http://localhost:3000" is not allowed for this project`. The other frameworks already pinned the port in their own dev-server config (Vite's `server.port` + `strictPort`, Angular's `serve.options.port`) and are unchanged. An explicit port also turns a busy port into a loud `EADDRINUSE` instead of a silent move to a rejected origin.
