---
"@zitadel/server": patch
---

Management APIs no longer treat session, OIDC, or PAT bearers as the project secret. Only project and preview tokens mint an `sk_proj` principal. Pre-#760 project secrets with no Type field (`TokenTypeUnspecified`) also stop authenticating.
