---
"@zitadel/cli": patch
---

`zitadel setup` now patches an existing SvelteKit, SolidStart, Qwik City or TanStack Start app instead of failing on it. The four patchers wrote the app shell and landing page (SvelteKit's `+layout.svelte` and `+page.svelte`, the other three's `routes/index.tsx`) on every run, so setup stopped with `E_CONFLICT` on any app that already had them and `--force` overwrote the user's own root layout and homepage. Like the Next and Nuxt patchers, they now write those files only when setup created the app skeleton itself and report them as conditionally scaffolded, so a pre-existing app keeps its shell and landing page while still getting the auth boundary and the login, register and profile routes.
