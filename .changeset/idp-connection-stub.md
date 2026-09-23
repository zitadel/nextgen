---
"@zitadel/server": minor
---

The identity provider connection endpoints answer instead of reporting themselves unimplemented: `POST /idps` creates a connection or revises the one holding that slug, `POST /idps/query` lists them, and `GET /idps/{id}` returns one. This is a placeholder so the CLI's connection syncer can be built and run against a local server: connections are held in the server process's memory, so they do not survive a restart and are not shared between replicas, and schema validation, the immutable-field rules and revision history arrive with the real service.

The flow engine also answers the reserved `sso` action instead of refusing it: a submit carrying an `sso_provider_id` returns a step whose `redirect_url` is the connection's authorization endpoint, and a new `/__nextgen/idp/callback` route exchanges the code and resumes the flow on `register-sso` or `sso-conflict`. This is a placeholder for the same reason and with sharper limits: the authorization request carries no PKCE, the id_token's signature is **not** verified, no identity link is recorded (a returning user is matched on the email claim), and pending authorizations live in process memory. It exists so the CLI and the login components can be driven end to end before the engine's own implementation lands.

The callback is held to the same rules as the rest of the surface even though it is a placeholder: the app origin it redirects back to is checked against the project's registered origins, a nonce cookie ties the return leg to the browser that started it, the response is `no-store` with no referrer so the code cannot reach a cache or a third-party script, the token endpoint must be https (or loopback http) and is fetched through the hardened egress client, and an `email_verified: false` identity is refused.

