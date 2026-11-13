---
"@zitadel/cli": minor
---

`setup` now has the Vite dev proxy of a React, Vue, Solid, Svelte or Qwik app read the server's address from `ZITADEL_URL` (the process environment, then `.env.local`) instead of fixing it in `vite.config.*`, so a test run can point the app at its own server. `doctor` fails a proxy an older CLI wrote until `doctor --fix` moves it, which keeps the app on the same server by writing it to `.env.local`; a proxy changed by hand is left alone, and the failure says what to change.
