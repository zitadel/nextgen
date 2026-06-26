---
"@zitadel/sdk-next": minor
"@zitadel/cli": minor
"@zitadel/api": patch
---

Add React components for the auth widgets and scaffold them from the CLI.

`@zitadel/sdk-next/react` now exports `<ZitadelLogin>` and `<ZitadelLogout>`, built with `@lit/react`'s `createComponent`. They wrap the Lit web components as real, typed React components: the server renders the inert tag and the client upgrades it, so consumers need no `next/dynamic({ ssr: false })` and no `custom-elements.d.ts`. `zitadel setup` scaffolds `/login`, `/register`, and `/profile` pages that render these components.

The SDK config handle is now stored on a `globalThis` slot keyed by `Symbol.for(...)` instead of a module-local variable. Bundlers can emit more than one copy of the config module — `@zitadel/components` bundles its own — and a module-local variable gave each copy its own value, so `configureZitadel()` on the app side and `getZitadelConfig()` inside the web component read different slots and the widget never saw its config. A registered-symbol global is shared across every copy.

The scaffolded pages are marked `"use client"` so `configureZitadel()` runs in the browser and populates that client-side global; in a plain Server Component it would run only on the server, leaving the browser global empty.
