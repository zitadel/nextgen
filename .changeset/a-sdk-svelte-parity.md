---
"@zitadel/sdk-svelte": minor
---

Clearing a prop now restores the widget's default instead of keeping the previous value, and
`ZitadelLogin` and `ZitadelLogout` render their children into the element, so `ZitadelLogout` accepts a `<template>` for a
custom sign-out control and `ZitadelLogin` accepts `attribution-trailing` content.
