---
"@zitadel/sdk-qwik": patch
---

Clearing a prop now restores the widget's default (for example `suppressHeader`, the session card's
heading and the login `purpose`), and clearing `project` or `locales` drops them instead of keeping
the old value. Children are projected into the widgets, so `<ZitadelLogout>`'s `<template>` menu
and the login's attribution slot work. Handler QRLs load before the listeners are attached, so a
handler for an event the widget navigates right after (sign-out, a redirect) runs before the page
leaves.
