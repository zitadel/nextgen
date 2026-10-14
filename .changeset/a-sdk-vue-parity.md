---
"@zitadel/sdk-vue": patch
---

The components now render their default slot into the element, so `ZitadelLogout` accepts a
`<template>` for a custom sign-out control and `ZitadelLogin` accepts `attribution-trailing`
content. An unset or cleared prop leaves the widget on its default, so `ZitadelSession` without a
`heading` shows "Signed in as" again.
