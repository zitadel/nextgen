---
"@zitadel/sdk-core": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-qwik-router": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-vue": minor
"@zitadel/api": minor
---

Every SDK now documents its whole public API: each export, prop, event and option has a TSDoc comment that says what it is and why it exists, and each package builds a warning-free API reference with a cover page. The widget SDKs also stop re-exporting everything from `@zitadel/sdk-core/types` and export an explicit list of types instead, so the internal helper types `WidgetName`, `WidgetTag`, `StandardAttributeName`, `StandardAttributes`, `StandardAttributeProps` and the `Zitadel*EventMap` interfaces are no longer exported from the SDKs. The purpose type is now `ZitadelFlowPurpose`, declared in `@zitadel/sdk-core` instead of re-exported from the generated API client. No value export changed.
