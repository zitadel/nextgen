---
"@zitadel/sdk-nuxt": patch
---

The Nuxt SDK now ships the layout Nuxt modules use: the module and its `./server` entry bundled and minified with source maps, the runtime directory file by file (so Nuxt compiles it inside your app), and a `module.json` that names the module. Its exports, types and behavior are unchanged.
