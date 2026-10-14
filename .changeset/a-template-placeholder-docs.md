---
"@zitadel/components": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-qwik": patch
---

The READMEs show how to write a `<ZitadelLogout>` template's `{{display}}` placeholders so the
framework does not compile them first: `v-pre` in Vue, `{'{{display}}'}` in Svelte and a string
literal in React. The `<zitadel-session>` element is documented in the components README. The
install lines in the READMEs and agent skills name the `@alpha` tag, the Solid skill states the
`^1.8.0` peer range, and the Svelte skill mounts the widgets after `onMount` under SvelteKit.
