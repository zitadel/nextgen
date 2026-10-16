---
"@zitadel/cli": minor
---

`setup` and `doctor` now refuse a Nuxt 3, Vue 2 or pre-1.8 Solid app up front with
`E_UNSUPPORTED_PROJECT_SHAPE`, instead of writing the integration and failing at install on the
SDK's peer dependency. Angular's floor uses the same check and error code as every other
framework, so a range such as `^16 || ^17` that admits a supported version is no longer refused.
