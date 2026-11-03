---
title: Add login to an existing SvelteKit, SolidStart, Qwik City or TanStack Start app
summary: zitadel setup now patches an existing SvelteKit, SolidStart, Qwik City or TanStack Start app instead of failing on it, and leaves its layout and homepage alone.
date: 2026-10-21T22:08Z
pulls: [2190]
---

`zitadel setup` now patches an existing SvelteKit, SolidStart, Qwik City or TanStack Start app instead of stopping with `E_CONFLICT`. Like the Next.js and Nuxt patchers, it writes the app shell and landing page only when it created the app itself, so your own root layout and homepage stay as they are, and the app still gets the auth boundary and the login, register and profile routes.

[Add Zitadel to an existing app](https://preview.zitadel.com/docs/get-started/existing-app)
