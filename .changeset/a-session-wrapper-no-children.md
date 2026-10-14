---
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
---

`ZitadelSession` no longer accepts children, slot content or projected content. `<zitadel-session>`
has no slot, so anything passed in was never shown; React, Solid and Svelte now reject `children` at
compile time, and Vue, Angular and Qwik put nothing into the element. Remove any content you passed
to the session card. `ZitadelLogout` keeps its `<template>` for a custom sign-out control. Each SDK's
Agent Skill now also explains that the session widgets render nothing and report a missing session
when the visitor is signed out, that the card then goes to its `postSignOutUrl`, and that any other
failure is reported as a session error.
