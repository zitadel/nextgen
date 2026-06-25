---
"@zitadel/sdk-solid": patch
---

Package `@zitadel/sdk-solid` so its components hydrate under SSR (SolidStart), not just in a client-only SPA.

A Solid component library must ship its JSX-preserving source under a `solid` export condition so the *consuming* app compiles it for both server and client; a single pre-bundled `index.js` cannot hydrate when imported from `node_modules` (see solidjs/solid-start#1110). The package now builds with `tsup-preset-solid`, emitting `dist/index.jsx` (the `solid` condition) alongside the compiled `dist/index.js` and the `.d.ts`. With this, `<ZitadelLogin>` / `<ZitadelLogout>` render correctly in a SolidStart app with no client-only guard at the call site.
