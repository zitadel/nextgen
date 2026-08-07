---
"@zitadel/api": minor
"@zitadel/server": patch
---

Drop the OIDC/OAuth surface from the OpenAPI contract. The spec described
discovery, authorize, token, keys, userinfo, revoke, introspect, device
authorization, and end-session endpoints that this server does not serve,
so the generated clients advertised operations that could never succeed.

Removed operations from the generated `@zitadel/api` client:

- `getOpenIDConfiguration`, `authorizeGet`, `authorizeDevice`, `getToken`,
  `getUserInfo`, `getKeys`, `revokeToken`, `introspect`, `endSession`
- `submitFlowEvent` (`POST /flow/{id}/event`)
- `activateFlowDefinition` / `deactivateFlowDefinition`
  (`POST /flow_definitions/{id}/activate` and `/deactivate`)

The `usernamePassword` security scheme is gone with them; `oauth2` and
`nextgenSession` are unchanged.

Sign-out is the `revokeMySession` operation (`DELETE /sessions/me`). JWKS
for local development is still served by `@zitadel/api-mock` at
`/auth/keys`, but as a mock-only route rather than a contract operation.
