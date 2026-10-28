# POC findings: the CLI and MCP clients on the platform project's OAuth server

> **Status:** Findings of a proof of concept, not a design. The code is on
> branch `claude/poc-platform-oauth-415a8f` and is not a merge candidate.
>
> **Date:** 2026-10-28
>
> **Tests:** the claim in the [identity model](https://github.com/zitadel/nextgen/pull/2445)
> that an agent using Zitadel's own API or MCP server follows the same rules
> as any app, because the platform project is a project like any other.

## What was built

| Piece | Where | Shape |
| --- | --- | --- |
| The `zitadel` app | `internal/oauth/app.go` | Declared in the server binary: client `cli` (public, first-party, loopback on any port), API `platform` (`aud` = the public base), API `mcp` (`aud` = `<base>/mcp`), and registration through client ID metadata documents (CIMD) and RFC 7591 |
| Authorization server | `internal/oauth` | Issuer `<base>/oauth/proj_platform`. RFC 8414 and RFC 9728 metadata, JWKS, authorize, consent, token, revoke and register |
| Tokens | `internal/oauth/token.go` | JWT access tokens (`typ: at+jwt`, EdDSA) signed with the platform project's existing token signing key, one `aud` each (RFC 8707). Codes and refresh tokens are sealed JWEs whose single-use records sit in `tokens` |
| User bearer | `internal/api/security.go` | The API takes a platform access token where a console session may act, as the same principal and grants (ADR 053 §5) |
| `/mcp` | `internal/oauth/mcp.go` | A Streamable HTTP stub: JSON responses, no stream, and a `whoami` tool |
| CLI | `apps/cli/src/lib/login`, `login`, `whoami`, `logout` | Discovery, PKCE (S256), loopback redirect, and a `0600` token store in the user config directory. `deployment list` falls back to the login |

It is behind `platform.oauth.enabled` (plus `client_id_metadata_documents`
and `dynamic_registration`) and needs `platform.bootstrap_project`.

## What ran end to end

Against a server built from the branch, started by `zitadel start`:

- **The CLI.** `zitadel login --no-open` printed the authorize URL. In a
  signed-out browser it led to the platform login (the console's
  `<zitadel-login>`), where the developer signed in. The CLI got a code on
  `127.0.0.1:<port>`, and `whoami` answered from `GET /users/me` with the
  bearer.
- **The developer's projects.** `deployment list` with no project secret
  listed a project the developer's team claimed, and answered `E_NOT_FOUND`
  for one it did not (ADR 053 §7).
- **Logout.** `logout` revoked the refresh token at the server, and `whoami`
  then failed with `E_CREDENTIAL_MISSING`.
- **Claude Code 2.1.309.** `claude mcp add --transport http …` got the 401 and
  the `resource_metadata` challenge. It found both metadata documents by path
  insertion, chose CIMD on its own
  (`client_id=https://claude.ai/oauth/claude-code-client-metadata`), and sent
  `resource`, `prompt=consent` and `openid profile email offline_access`. The
  server fetched its document, matched its `localhost` loopback redirect, and
  showed consent. Claude Code then reported ✔ Connected after `initialize`
  and `tools/list`, and probed `GET /mcp` for a stream, which got a 405.
- **`tools/call whoami`.** It returned the developer (`sub`) and the client
  (`client_id`) for a third-party token from the RFC 7591 path, through the
  same consent screen. The call through Claude Code's model was not run: the
  isolated Claude Code config had no Anthropic login.
- **Audiences.** An MCP token got 401 on the API, and an API token got 401 on
  `/mcp`.

Tests: PKCE, redirect matching and resource selection are unit tests. The
code exchange, the audience, and refresh rotation with replay revocation run
against SQLite (`sqlite_integration`), and the new statements have
`stmttest` suites. The user bearer has security-handler tests, and the CLI's
loopback flow and token store run against a fake authorization server.
Postgres and Spanner were not run.

## What worked

- **One app document was enough.** The CLI, the API, the MCP server and open
  registration fit in one app, one function in the binary. Nothing needed a
  second noun.
- **Grants needed no change.** Mapping the token to the ScopeContext a
  platform session already builds made ADR 053's resolver work unchanged:
  team grants and the `NotFound` boundary were exercised. The platform
  operator path follows by construction but was not run.
- **The keys and the token store already existed.** Every project's EdDSA
  token signing key is minted at creation and was never used. The `tokens`
  table's reserved `oidc_access_token`/`oidc_session_id` held codes and
  refresh tokens without a migration, plus two statements (consume once,
  delete a grant).
- **One audience per token is the right boundary.** It kept a third-party MCP
  client out of the management API with no scope vocabulary at all.
- **CIMD needs no storage, and neither does DCR.** A dynamically registered
  `client_id` can be the sealed registration (about 500 characters). The
  "DCR needs a table" assumption only holds for listing or revoking clients
  one by one.
- **The login is reusable as it is.** `authorize` sends the browser to the
  console's `/login?next=…`, and the mux routes `<console>/oauth/continue` to
  the authorization server. The console needed no change.

## What was missing

- **The issuer.** ADR 081 §5 says the server's own origin is never an issuer
  and §6 puts the browser endpoints under an app's `/__nextgen` proxy. The
  platform project's login is the console, on the server's origin, so its
  issuer has to be there. ADR 081 needs a carve-out for it.
- **Login handoff.** ADR 081 §8's `auth_request` through `<zitadel-login>` is
  not built. The `next` route is fragile:
  - it ties the server to the console's mount path, and does not route on the
    hosted cloud, whose console is a separate service;
  - per the console's login route, a browser that already has a session but
    lands on `/login` redirects inside the SPA and never reaches the server.
- **Consent, grants and connected apps.** Without storage, consent is asked
  every time, and nothing lists "the apps you connected". That needs a grants
  table (user, client, API, scopes, last used) behind the consent step and
  ADR 082 §8's me endpoints. The grant id rides in `oidc_session_id` for now.
- **Where a user bearer may go.** Operations that only a project secret calls
  read `ScopeContext.ProjectID` as the target. So the bearer is limited to
  the operations a session may call (`userBoundSessionOperations`), and
  `deploy` still needs the secret. That list belongs in the spec: a
  `userBearer` scheme beside `oauth2`, which today means only "project
  secret". The generated clients cannot tell the two apart.
- **Scopes for agents on the management API.** A consented third party acts
  with all of the developer's grants. The POC keeps the platform API closed to
  third parties because nothing narrower exists. Claude Code asked for every
  scope in `scopes_supported` (`openid profile email offline_access`), so
  scopes are the only lever an MCP server gets. The API needs a scope
  vocabulary, or consent has to name capabilities.
- **ID tokens.** The server advertises `openid` but issues no ID token.
  ADR 082 §7 wants RS256 for ID tokens, and the project has only an EdDSA
  key. Either drop `openid` from the metadata or add an RS256 key.
- **Audit.** Codes and refresh tokens reuse `auth.token.issued` and
  `auth.token.revoked`. Consent, denial and replay revocation have no events
  of their own.
- **The first-party skip.** `cli` skips consent and redirects to a loopback,
  so any page can navigate a signed-in browser into issuing a code to a local
  port. PKCE keeps the code useless to that page, but not to a local process
  that listens there. The Fetch Metadata check refuses only background
  requests. `gh` asks once; consider consent once per device.
- **CLI credential precedence.** Falling back from the project secret to the
  developer's login goes against `credentials.ts`'s rule that a credential is
  never tried in another's place. `gh` and `vercel` make the login the default
  and let the environment override it. This needs a decision.
- **Deployment shape.** The well-known paths sit at the host root, so a
  `public_base` with a path is refused. ADR 077's `/api/v1` changes the
  platform API's identifier and the RFC 9728 path. The CIMD cache is per
  replica, and CIMD needs egress to the client's host, `claude.ai` here.

## What the identity model got right

- **App = clients + APIs + registration** matched what the code needed, with
  `aud` as an API's identifier.
- **A registered client joins an app as a third party, and consent is
  required.** Claude Code arrived through CIMD and was a third-party client
  of `zitadel` for exactly one request. Nothing about it had to be stored to
  serve it.
- **The developer is a user of the platform project.** `sub` was that user,
  and ADR 053's grants carried the token to their projects.
- **An agent acting for a user** is told apart by `client_id` (and `act`
  later). `whoami` showed both.
- **Open question 4: how a registration finds its app.** The POC suggests an
  answer. A registration request names no API, but every authorization
  request carries `resource`, which names one API and therefore one app.
  Registration can stay per issuer, and the app is resolved at `authorize`.

## What it got wrong or left out

- **"The platform project is a project like any other"** holds for tokens and
  grants, but not for three things:
  - its issuer is the server's origin;
  - its login is the console's, not a scaffolded app's;
  - its app is code in the server binary, with no release to ship
    `.zitadel/apps/zitadel.json`.

  The model's code-or-API table needs a third row: apps the server declares,
  read-only and versioned with the binary.
- **Zitadel's own API is unlike any other API.** A platform user's token is
  the only one that reaches other projects' resources (ADR 053). That is why
  third parties need scopes there before anything else.
- **"Dynamic registration … agents become third-party clients of the app"**
  suggests a stored client. With CIMD, and with sealed DCR, there is none
  until a grant exists. The console list "third parties that registered" can
  only come from grants.

## Follow-ups worth deciding

1. Add a grants table: consent, connected apps, and per-client revocation.
2. Add a `userBearer` security scheme, with the operations it reaches
   declared in the spec.
3. Choose a scope vocabulary for the management API, or capability consent,
   before the platform API is opened to third parties.
4. Amend ADR 081 for the platform project's issuer and login, and build
   §8's `auth_request` handoff to replace the `next` route.
5. Decide the CLI's credential precedence and `deploy` with a user bearer.
