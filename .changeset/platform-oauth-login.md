---
"@zitadel/cli": minor
"@zitadel/server": minor
---

`zitadel login` signs you in to a server as yourself, in the browser: it finds the server's authorization server from the API's protected-resource metadata and signs in with PKCE on a loopback redirect. The tokens are kept in the CLI's user config directory, readable by you alone. `zitadel whoami` shows who the server says you are, and `zitadel logout` revokes the sign-in. `zitadel deployment list` acts as you when no project secret is set. The server offers this behind `platform.oauth.enabled`, which needs `platform.bootstrap_project`. It serves the platform project's OAuth 2.1 authorization server for the CLI and for MCP clients, which register through client ID metadata documents or dynamic registration and ask for consent, and an `/mcp` endpoint with a `whoami` tool. `GET /users/me` and the operations a console session may call also take the access token it issues.
