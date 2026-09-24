---
"@zitadel/components": minor
"@zitadel/config": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-vue": minor
---

Render the identity providers a login step offers. A new `<zl-sso-providers>` atom draws one button per entry in the step's `sso_providers`, choosing one submits the reserved `sso` action with that connection's id, and the orchestrator follows the `redirect_url` the engine answers with — a new `zitadel-flow-redirect` event, kept separate from `zitadel-flow-complete` because nobody is signed in yet and the flow resumes when the provider returns. Every SDK forwards it as `onFlowRedirect`. The atom is driven entirely by the step's data: a mark is looked up by the connection's `template` (Google ships one), and a template without one still gets a working button rather than a wrong logo, which is what a tenant's own OIDC connection will always look like. Copy for the provider buttons and for the `register-sso` and `sso-conflict` steps is added to every builtin locale, and `applySsoProviders()` in the mock API package lets a test or playground offer providers the way a project that ran `zitadel sso enable` does.
