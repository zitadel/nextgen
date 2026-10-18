---
"@zitadel/components": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-qwik": patch
---

The READMEs and agent skills now explain what to do when an app server-renders the widgets: mount them on the client only, after hydration, or, where the SDK wrapper writes the project id and proxy path as attributes (React, Solid, Svelte), pass them as strings instead of a `project` object; the Vue, Angular and Qwik wrappers set them as element properties, so those pages point to client-only mounting or a raw `<zitadel-login>` element.
