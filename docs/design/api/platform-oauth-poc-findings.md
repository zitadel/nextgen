# POC findings: the CLI and MCP clients on the platform project's OAuth server

> **Status:** Findings of a proof of concept, not a design. The code is on
> branch `claude/poc-platform-oauth-415a8f` and is not a merge candidate.
>
> **Date:** 2026-10-28
>
> **Tests:** the claim in the [identity model](identity-model.md)
> that an agent using Zitadel's own API or MCP server follows the same rules
> as any app, because the platform project is a project like any other.

## What was built

| Piece | Where | Shape |
| --- | --- | --- |
| The `zitadel` app | `apps/api/internal/oauth/app.go` | Declared in the server binary: client `cli` (public, first-party, loopback on any port), API `platform` (`aud` = `<base>/api/v1`, the base the API answers under), API `mcp` (`aud` = `<base>/mcp`), and registration through client ID metadata documents (CIMD) and RFC 7591 |
| Authorization server | `apps/api/internal/oauth` | Issuer `<base>`, the domain the console shares with the server, with its endpoints under `/oauth/proj_platform`. RFC 8414 and RFC 9728 metadata, JWKS, authorize, token, revoke and register; zitadel/oidc's `op.Server` answers token, revoke and JWKS |
| Login handoff | `apps/api/internal/oauth/authorize.go`, `apps/api/internal/domain/flow_authorization.go`, `<zitadel-login>` | Authorize sends the browser to the console's `/login?auth_request=<handle>` (ADR 081 §8). The widget sends the handle on `POST /flow`, the flow signs the user in, shows the reserved `consent` step when the client needs it (§11), and ends in a redirect to the client with the code (§9) |
| Tokens | `apps/api/internal/oauth/token.go` | JWT access tokens (`typ: at+jwt`, EdDSA) signed with the platform project's existing token signing key, one `aud` each (RFC 8707). Codes and refresh tokens are sealed JWEs whose single-use records sit in `tokens` |
| Consents | `apps/api/internal/service/consent.go`, table `consents` | One per user, client and API, with the scopes agreed to. A third party is asked again only for a new scope or on `prompt=consent`; a first-party client is never asked, but gets one too. Codes and refresh tokens are `tokens` rows naming it as `oidc_session_id`, so revoking it ends them. It lasts `platform.oauth.consent_lifetime` (90 days) at most, and the refresh token's lifetime unused. `GET /users/me/consents` and `DELETE /users/me/consents/{consent_id}` list and revoke them |
| User bearer | `apps/api/internal/api/security.go` | The API takes a platform access token where a console session may act, as the same principal and grants (ADR 053 §5) |
| `/mcp` | `apps/api/internal/oauth/mcp.go` | A Streamable HTTP stub: JSON responses, no stream, and a `whoami` tool |
| CLI | `apps/cli/src/lib/login`, `login`, `whoami`, `logout` | Discovery, PKCE (S256), loopback redirect, and a `0600` token store in the user config directory. Every project command acts as the developer unless the run names a project secret, ahead of the one setup stored; `--credential` forces either, and `preview` and `claim` keep the secret |

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
- **The login was reusable as it was.** The POC sent the browser to the
  console's `/login?next=…` and routed `<console>/oauth/continue` back to the
  authorization server, with no console change. The handoff below replaced
  that route.

## What was missing

- **The issuer.** ADR 081 §5 said the server's own origin is never an issuer
  and §6 puts the browser endpoints under an app's `/__nextgen` proxy. The
  platform project's login is the console, on the server's origin, so its
  issuer has to be there. §5 now carves it out (see below).
- **Login handoff.** ADR 081 §8's `auth_request` through `<zitadel-login>`
  was not built (it is now, below). The `next` route was fragile:
  - it ties the server to the console's mount path, and does not route on the
    hosted cloud, whose console is a separate service;
  - per the console's login route, a browser that already has a session but
    lands on `/login` redirects inside the SPA and never reaches the server.
- **Consents and connected apps.** Without storage, consent was asked every
  time, and nothing listed "the apps you connected". Consents are stored now
  (see the table).
- **Where a user bearer may go.** Operations that only a project secret calls
  read `ScopeContext.ProjectID` as the target. So the bearer is limited to
  the operations a session may call (`userBoundSessionOperations`), and
  `deploy` still needs the secret. That list belongs in the spec: `oauth2`
  for user tokens, beside a scheme for the PATs that the project's and
  teams' secrets become ([identity model](identity-model.md#principals)).
  Today `oauth2` means only "project secret", so the generated clients cannot
  tell the two apart.
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

## Loopback redirects and v4's double-decode report

A Zitadel v4 report showed codes stolen through native-client loopback
redirects. The validator decoded `redirect_uri` twice and redirected to the
once-decoded value, so `http://127.0.0.1%2Fcallback%23@attacker.example/`
passed as `http://127.0.0.1/callback#@attacker.example/` while the browser
went to `attacker.example`.

- **One decode, one parse.** The request's query or form parser decodes the
  parameter once, and `httputil.ParseRedirectTarget` parses that value once.
  Nothing decodes it again.
- **The checked URL is the redirected URL.** The value must be its own
  canonical form, so the browser is sent byte for byte to the URL that was
  checked, with only `code`, `state` and `iss` added.
- **What is refused.** Userinfo, any `#` (an empty one too), and every host
  but the registered loopback literal. Only the port may differ (RFC 8252
  §7.3).
- **What changed.** The v4 payload was already refused, as userinfo. The
  canonical-form rule closed three harmless spellings the matcher used to
  accept and re-serialize: an empty `#`, `LOCALHOST` and an uppercase scheme.
- **Tests.** The matcher's table, and `authorize` with the payload encoded
  once and twice (400, no `Location`). The `Location` of an accepted request
  is checked against the URI that was validated. The payload is also in the
  shared corpus, `apps/api/internal/httputil/testdata/redirect_targets.json`, which
  the API mock's port reads too.

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
- **How a registration finds its app.** The POC's answer is now the model's
  ([Apps](identity-model.md#apps)). A registration request names no API, but
  every authorization request carries `resource`, which names one API and
  therefore one app. So a client registers at the project and joins the app
  its first `resource` names.

## What it got wrong or left out

- **"The platform project is a project like any other"** holds for tokens and
  grants, but not for three things:
  - its issuer is `server.public_base`'s origin, which it shares with the
    server;
  - its login is the console's, not a scaffolded app's;
  - its app is code in the server binary.

  The server now deploys the platform project's configuration as a release
  at every start (#2469), so once apps live in releases (#2452) the `zitadel`
  app can ship as `apps/zitadel.json` in it, like any project's.
- **Zitadel's own API is unlike any other API.** A platform user's token is
  the only one that reaches other projects' resources (ADR 053). That is why
  third parties need scopes there before anything else.
- **"Dynamic registration … agents become third-party clients of the app"**
  suggests a stored client. With CIMD, and with sealed DCR, there is none
  until a consent exists. #2452 stores registrations at the project, which
  replaces the sealed ids; a CIMD client still needs no record.

## Decided after the POC (2026-10-29)

- **The issuer** is the domain the console is served on:
  `server.public_base`'s origin, which the console shares with the server in
  the cloud and on a self-hosted server (ADR 081 §5). The console's other
  origins (`server.console_origins`) never are one. Its metadata sits at the
  domain's root, and its endpoints under `/oauth/{project_id}/` (§6). The
  cloud routes only the server's own paths to it (#2566), so it needs
  `vercel.json` rules for those paths and `/mcp` when it turns this on.
- **The library.** zitadel/oidc v3.51.16's `op.Server` answers token,
  revocation and JWKS. Authorize stays this package's: the library renders
  the errors `VerifyAuthRequest` returns instead of redirecting them, leaves
  `iss` (RFC 9207) off its error redirects, and has no `resource`
  (RFC 8707).
- **Consent** is transient data stored like sessions: a record with a
  lifetime that the user lists and revokes (ADR 082 §8), with an audit event
  each time one is given or revoked.
- **The CLI's credentials.** A secret named for the run, in the environment
  or `--env-file`, wins; then the developer's login; then the secret setup
  stored. `--credential project|login` forces one, the envelope names the
  one used, and nothing falls back to the other after a failure.

## The login handoff (built 2026-11-03)

ADR 081 §8–§11 for the platform project, whose login app is the console:

- **The handle.** Authorize checks the request, seals it into an opaque
  handle and sends the browser to `<console>/login?auth_request=<handle>`.
  A cookie per request, `__Host-_zauthz_<id>`, holds a nonce whose hash is
  in the handle, so the handle opens nothing in another browser, and a
  second request in the same browser leaves the first one alone. The flow
  clears the cookie when it ends.
- **No `auth_requests` table.** The flow keeps the request in its sealed
  `_zflow` cookie, as it keeps all its state. The worst case (a 512-byte
  `state`, the longest authorize takes, and long client and redirect URLs)
  seals to about 3.3 KB of the cookie's 4 KiB; a test holds it there. A
  table is needed once requests must be revoked or counted, such as by a
  revoked release (§10).
- **How a flow answers.** It ends in a redirect to the client whatever its
  definition's terminal step says, and keeps its handoff, so the console
  keeps the session (§9). The `consent` step comes after the sign-in, for a
  third-party client or on `prompt=consent`. A live session answers at once,
  under the consent step when needed and without a handoff. `prompt=login`
  signs in again, and `prompt=none` shows no step. A failure the user has not
  seen goes back only to a first-party client or a loopback URI, or the flow
  refuses with `flow.auth_request_invalid`.
- **Reserved names.** The validator and the meta-schema refuse a definition
  step named `consent` or `account_choice`.
- **The console** keeps `auth_request` in the URL and renders the widget on
  `/login` even with a live session, so the flow can answer.

## Every CLI command as the developer (built 2026-11-03)

- **Two schemes for two tokens.** The spec's `oauth2` was the project secret
  in practice. The secret is now its own scheme, `pat` (an http bearer that
  keeps the scopes an operation needs, as OpenAPI 3.1 roles), and `oauth2` is
  the platform project's authorization code flow: a person's access token.
  Every operation that takes `pat` takes `oauth2` too, except the app plane
  (auth attempts, challenges, handoffs, session create and exchange, the
  claim, passkey registration), whose handlers read a secret's home as the
  target or prove the secret. A test walks the spec to hold that line, and
  the Go `userBoundSessionOperations` map no longer gates the bearer.
- **One header, two handlers.** ogen runs every scheme an operation lists,
  each against the same `Authorization: Bearer`, and fails the request on any
  handler's error. So `HandlePat` skips a person's token (a JWS) and
  `HandleOAuth2` skips a secret (a JWE). The generated Go client's
  `SecuritySource` gains `Pat`, which breaks its implementers.
- **A person's projects.** Their token is homed in the platform project, so
  every CLI call names its project, and `POST /projects/query` lists the
  projects they may act on (no filter or sort), as `GET /users/me/projects`
  does, which takes the token too.
- **No redirect to a client from the server.** A failure `authorize` finds
  after the redirect URI checked out goes through the login like every
  answer (ADR 081 §8), which closed CodeQL's open-redirect alert.
- **The CLI's order**, as decided: a secret the run names (the process
  environment, `--env-file`, or the files of an environment other than
  `development`), then the developer's sign-in, then the secret setup stored.
  Setup writes the secret into `.env.local` and `.env.development.local` as
  well as `.zitadel/secret`, so those count as stored, or a sign-in would
  never win in a set-up project. `--credential project|login` forces one, the
  envelope's `credential` names the one used, and a refusal is final.
  `preview` and `claim` never act as the developer. The oclif layer gets the
  sign-in lookup from the CLI's entry, which keeps `lib/login` out of it.
- **Checked by hand** against a built server: `projects list`, `deployment
  list`, `events list` and `variable list` as the developer, a variable
  written with the stored token, `--credential` both ways, and the app plane
  refusing the token (401).

## Follow-ups

1. Register clients through #2452's stored registrations instead of sealed
   ids, and implement its `ClientRegistrationConsents` on the consents.
2. PATs proper (identity model): one token kind with an owner type and a
   prefix per owner, which the `pat` scheme already names.
3. Before third parties reach the platform API: the model's "a client's
   scopes are its ceiling", which on Zitadel's own API means checks that
   intersect a principal's roles with the token's scopes. No issue tracks it
   yet.
4. One flow cookie name per flow (ADR 081 §8.3): two authorization requests
   in one browser's tabs still share `_zflow`, so the second flow ends the
   first.
5. From the CLI's run: `status --credential login` suggests `claim
   --credential login`, which claim refuses; `zitadel env` does not say which
   credential a run would use; an api dry run may refresh an expired sign-in;
   and the API mock checks the bearer on two routes only.
6. Index `tokens (project_id, oidc_session_id)` before consents see real
   traffic: revoking one, or a replay, scans every token of the project. On
   Postgres, build the index `CONCURRENTLY` in a migration of its own.
7. Delete a client's consents in batches: one transaction for all of them
   can pass Spanner's 80,000 mutations per commit.
8. The rest of ADR 081 §8.5 and §11: `login_hint`, `prompt=create`,
   `max_age`, `acr_values`, and account choice.
9. Decide whether signing out of the console ends the CLI's sign-in. §9
   binds the code to the session; the consents, and so the CLI's refresh
   tokens, outlive it.
10. An end-to-end lane that signs the CLI in through the console. The
    pieces are tested at their own layers, and the whole by hand.
