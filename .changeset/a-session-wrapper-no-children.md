---
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-qwik": patch
---

Each SDK's Agent Skill now explains that the session widgets render nothing and report a missing
session when the visitor is signed out, that the card then goes to its `postSignOutUrl`, and that
any other failure is reported as a session error.
