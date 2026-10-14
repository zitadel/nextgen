---
"@zitadel/cli": patch
---

Setup for SvelteKit, SolidStart, Qwik City and TanStack Start is hardened:

- The `dev` script is pinned to the port setup registers as the project's origin, with `--strictPort`. Their Vite dev servers served on 5173 while setup registered 3000, so a fresh app's login was refused as a foreign origin, and a busy port drifted silently.
- The auth boundary (`src/hooks.server.ts`, `src/middleware.ts`, `src/routes/plugin@nextgen.ts`, `src/start.ts`) and SolidStart's `vite.config` middleware registration are managed infrastructure, so `doctor` fails when they are missing instead of passing with auth gone.
- A SolidStart 1 app, and a Svelte or SvelteKit app on Svelte 4, is refused up front with the reason, instead of failing later on a missing `vite.config` or an uninstallable Svelte 5 component library.
- The setup summary names every framework with its version ("SvelteKit 3.0.1 · TypeScript · npm") instead of the raw id.
