---
"@zitadel/sdk-react": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-svelte": patch
---

`onSessionError` and `onSignout` (React, Svelte) and the `sessionError` and `signout` outputs (Angular) on the session and logout components now receive an event the widget raises the moment it connects, such as a session error from a load that fails immediately. Their listeners used to be registered after the element was attached, so that event was lost.
