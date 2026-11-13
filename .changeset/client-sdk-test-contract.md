---
---

The client SDKs (`@zitadel/sdk-react`, `@zitadel/sdk-vue`, `@zitadel/sdk-angular`, `@zitadel/sdk-svelte`, `@zitadel/sdk-solid`, `@zitadel/sdk-qwik`, `@zitadel/sdk-next`) run their edge, server-render and standard-attribute cases from the shared, unpublished test package, now named `@zitadel/framework-contract`. Their manifests gain it as a devDependency and their turbo tasks an edge to it; nothing they ship changes.
