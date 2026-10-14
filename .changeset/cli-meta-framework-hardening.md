---
"@zitadel/cli": patch
---

- A Svelte app on Svelte 4 is refused up front with the reason, instead of failing later on an uninstallable Svelte 5 component library.
- The setup summary names every framework with its version ("Angular 20.1.0 · TypeScript · npm") instead of the raw id; Angular, Solid and Qwik apps showed no version at all.
