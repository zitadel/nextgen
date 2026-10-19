---
"@zitadel/cli": patch
---

`doctor` now checks that `package.json` declares the SDK packages the app actually imports, such as `@zitadel/sdk-next`, or `@zitadel/sdk-sveltekit` plus `@zitadel/sdk-svelte`. Before, any `@zitadel/*` package passed, so an app that kept only the CLI as a dev dependency was reported healthy. The check names the missing package and `doctor --fix` re-adds it. The setup docs and the CLI reference now list all twelve `--framework` ids and the framework versions setup supports.
