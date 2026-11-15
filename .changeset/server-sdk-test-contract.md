---
---

The six server SDKs (`@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-sveltekit`, `@zitadel/sdk-solid-start`, `@zitadel/sdk-qwik-router`, `@zitadel/sdk-tanstack-start`) run their middleware and edge-runtime cases from one shared, unpublished test package. Their manifests gain it as a devDependency and their turbo tasks an edge to it; nothing they ship changes.
