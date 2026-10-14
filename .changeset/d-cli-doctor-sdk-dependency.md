---
"@zitadel/cli": patch
---

`doctor`'s dependency check now requires the SDK packages the app's framework imports, such as
both `@zitadel/sdk-sveltekit` and `@zitadel/sdk-svelte` in a SvelteKit app. Another `@zitadel/*`
package, such as the CLI itself, no longer satisfies it, and `doctor --fix` adds what is missing.
