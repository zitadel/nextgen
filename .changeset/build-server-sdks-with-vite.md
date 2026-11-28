---
"@zitadel/sdk-core": patch
"@zitadel/sdk-qwik-router": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-sveltekit": patch
---

`@zitadel/sdk-core`, `@zitadel/sdk-qwik-router`, `@zitadel/sdk-solid-start` and `@zitadel/sdk-sveltekit` now ship minified JavaScript with source maps and one type declaration file per source file. What they export is unchanged, except that `@zitadel/sdk-core/types` no longer declares three internal names (`NATIVE_NAMES`, `STANDARD_NAMES`, `NativeName`) that never existed at runtime.
