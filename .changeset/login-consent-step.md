---
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/config": minor
"@zitadel/api": minor
"@zitadel/server": minor
---

`<zitadel-login>` answers an authorization request. A page opened at `?auth_request=<handle>` starts its flow for that request, and the flow ends by sending the browser back to the client, after keeping the sign-in on the page's own origin. When a third-party client needs the user's consent, the flow inserts a consent step: the client's name, the host it returns to, the API it would call and a line for each scope, with Allow and Deny. A browser that is already signed in goes straight to that step, or back to the client. `zitadel-flow-step` names the flow's `client`, flow responses carry `client` and the step's `consent` (`@zitadel/api`), and the `centered` and `minimal` designs render the step. A flow definition can no longer name a step `consent` or `account_choice`.
