---
"@zitadel/sdk-nuxt": minor
---

A Nuxt app now needs `@zitadel/sdk-nuxt` and nothing else. The new auto-imported `useZitadelApi()` composable returns the typed API client of the configured project, so an app no longer installs `@zitadel/api` to call the API. Together with the module loading the widget elements itself, no app has to depend on `@zitadel/components`, `@zitadel/api` or `@zitadel/design-tokens`, and none of them needs a `build.transpile` entry: a production `nuxt build` and a dev server render the login page without them.
