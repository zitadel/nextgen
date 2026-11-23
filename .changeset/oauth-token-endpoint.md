---
"@zitadel/server": minor
---

The token endpoint `/oauth/<project_id>/token` exchanges an authorization code for an access token: a JWT signed with the project's key, valid for five minutes. The application authenticates with its client secret, in the `Authorization` header or in the form. No refresh token or ID token is issued yet, and the login does not issue codes yet.
