# Apps, Machine Identities and Client Credentials

> **Status:** Draft for discussion, the input for the ADRs and ADR amendments
> listed under [Impact](#impact-on-existing-adrs-and-design-notes).
> **Date:** 2026-10-28
> **Builds on:** [ADR 020](../../adrs/020-credentials-out-of-user-schema.md),
> [ADR 029](../../adrs/029-cryptography-secrets-and-key-lifecycle.md),
> [ADR 037](../../adrs/037-token-lifecycle.md),
> [ADR 053](../../adrs/053-cross-project-principals.md),
> [ADR 070](../../adrs/070-cli-auth-method-toggles.md),
> [ADR 082](../../adrs/082-oauth-and-oidc-server.md)

## Problem

Zitadel v4 splits OAuth parties into machine users (client credentials and
JWT profile against Zitadel) and apps (web, native, SPA, API, SAML), and
allows token exchange only on some of them. A single backend that serves an
API, calls Zitadel as itself and acts on behalf of its users ends up as three
entities: an API app for the resource server, a machine user for
machine-to-machine calls, and a web app for token exchange. Each has its own
credential, and only the machine user can hold permissions.

Nextgen is about to repeat that split. ADR 082 adds a `Service` app kind for
client credentials, while ADR 036 and ADR 053 §9 defer a separate
"PAT / service-user" credential for automation that calls Zitadel's own API.
Agents add a third shape: they authenticate non-interactively as themselves
and also act for a user after that user consented.

## The model in one table

An OAuth or SAML party plays up to three roles. v4 fused them into entity
kinds; this model keeps them apart.

| Role | Question it answers | Where it lives |
| --- | --- | --- |
| **Principal** | Who the token is about; what permissions attach to | An identity: a row in `users`, of a schema kind (`human-user`, `service`, `agent`, …) |
| **Client** | Who asks for tokens, how it authenticates, which grants it may use | A client row, owned by an app, an identity, or both |
| **Resource server** | Which audience and scopes a token is for | A protected API file (ADR 082 §5); it needs no identity of its own |

Rules that follow:

- **One identity model.** Machine identities are users of another schema
  kind, not a separate concept. The API keeps the name `users`.
- **An app is a client registration for a redirect-based protocol** (OIDC
  code flow, SAML). Anything non-interactive needs no app.
- **Every token with permissions has exactly one principal**: the user it was
  issued for, or the identity that authenticated as itself.

## Identities and capabilities

### The schema is the capability ceiling

A user schema already says how its users sign in, in `x-auth-methods`
(ADR 020, ADR 070). Non-interactive methods join the same block:

```jsonc
// objectType: service
"x-auth-methods": {
  "client_secret":   { "enabled": true },
  "private_key_jwt": { "enabled": true },
  "pat":             { "enabled": true, "max_lifetime": "P90D" }
}

// objectType: human-user
"x-auth-methods": {
  "password": { "enabled": true },
  "passkey":  { "enabled": true },
  "pat":      { "enabled": true, "max_lifetime": "P90D" }
}
```

- Method names follow OAuth (`client_secret`, `private_key_jwt`) so they match
  `token_endpoint_auth_method`.
- The schema is the ceiling. An identity may narrow it, never widen it.
- Disabling a method stops every credential of that kind on the next request;
  the rows stay, so enabling it again restores them. This is how `password`
  already behaves.
- Who may create a credential for whom (self through a me endpoint, an admin
  for others) is an operation policy (ADR 066).

### Passwords stay interactive

A password is checked only inside a flow, where MFA, step-up and lockout
apply. There is no password grant (ADR 082 §2). A user who needs
non-interactive access gets a PAT, or a client secret if their schema allows
it. A token endpoint opt-in for passwords
(`password.token_endpoint: true`, only for schemas without a required second
factor) is parked until a migration case needs it.

Using a password as a client secret would bypass MFA, share
`user_passwords.failed_attempts` between a person and their scripts, and tie
script rotation to password changes.

### Delegation is a separate block, later

Acting for someone else (`act_for`) and allowing others to act for you
(`delegate_to`) are permissions, not sign-in methods. They will live in their
own schema block (working name `x-delegation`) and are not designed yet. The
only constraint now: they do not go into `x-auth-methods`.

## Apps

An app keeps ADR 082 §3's shape and ownership (declared in
`.zitadel/apps/<slug>.json`, or registered through `POST /apps`), with two
changes.

**Protocol blocks.** The shared fields (slug, name, party, branding, allowed
APIs, the slug flows reference in `audience.app_ids`) stay on the app;
everything protocol-specific moves into a block. An app has one block or
both.

```jsonc
{
  "slug": "intranet",
  "name": "Acme Intranet",
  "party": "first",
  "apis": ["https://api.acme.dev/orders"],
  "oidc": {
    "type": "confidential",
    "redirect_uris": ["https://intranet.acme.dev/cb"],
    "auth_method": "private_key_jwt"
  },
  "saml": {
    "entity_id": "https://intranet.acme.dev/saml",
    "acs": [{ "url": "https://intranet.acme.dev/saml/acs", "binding": "post" }],
    "name_id": { "format": "persistent" },
    "attributes": { "email": "urn:oid:0.9.2342.19200300.100.1.3" }
  }
}
```

ADR 082's `kind` becomes `oidc.type`. Only `oidc` ships first, but the shape
should be fixed before apps ship, because the document is both a file and an
API body. SAML remains a non-goal of ADR 082; see [SAML](#saml) for what it
would add.

**No `Service` kind.** Client credentials belong to identities
([Clients](#clients)). A web app that also calls APIs as itself is bound to an
identity.

## Clients

### Storage

Every client credential hangs off one client row, whoever owns it. The token
endpoint has one lookup path: `client_id` → client row → credentials.

```text
oauth_clients
  project_id, id      PK; id minted (ADR 047), internal only
  client_id           UNIQUE (project_id, client_id)
  client_id_origin    minted | imported | metadata_document
  app_id              NULL → apps
  user_id             NULL → users   (the subject of client credentials)
  auth_method         NULL           (optional pin, RFC 7591 token_endpoint_auth_method)
  created_at
  CHECK (app_id IS NOT NULL OR user_id IS NOT NULL)
  UNIQUE (project_id, app_id)
  UNIQUE (project_id, user_id) WHERE app_id IS NULL

client_secrets
  project_id, id
  client_ref          → oauth_clients.id
  name
  encoded_hash        NULL   generated, imported or rehashed value
  variable_name       NULL   a declared app's ${{ NAME }} (ADR 062)
  origin              declared | registered | imported
  created_at, expires_at NULL, last_used_at
  CHECK (exactly one of encoded_hash, variable_name)

client_keys
  project_id, id
  client_ref          → oauth_clients.id
  kid                 UNIQUE per client
  name
  public_key          JWK
  origin              declared | registered | imported
  created_at, expires_at NULL, last_used_at

user_pats
  project_id, id
  user_id             → users
  name
  token_hash          UNIQUE (project_id, token_hash)
  scopes, audience
  created_by, created_at, expires_at, last_used_at
```

`oauth_clients` is a storage table, not an API resource. The API surface
stays apps and users: the app document carries its `client_id`, and an
identity exposes its `client_id` once its first credential exists
(`POST /users/{id}/secrets`, `…/keys`).

### The three client shapes

| Shape | `app_id` | `user_id` | Client credentials | Example |
| --- | --- | --- | --- | --- |
| Unbound app | set | — | refused: no subject | A web app that only signs users in |
| Identity only | — | set | `sub` = the identity | A job, an agent, a partner backend |
| Bound app | set | set | `sub` = the identity | A web app that also calls APIs as itself |

- **Binding** sets `user_id` on the app's client row. The `client_id` and the
  secret stay where they are, so binding and unbinding need no change on the
  client's side.
- **One identity-only client per identity**, with any number of named
  credentials under it. Jobs that need different permissions are different
  identities; jobs that need separate revocation are different credentials.
  The audit event records which credential authenticated (ADR 048).
- **A bound identity's schema caps the client.** Binding an app whose
  credential the identity's schema does not allow is refused, and tightening
  the schema later refuses the credential at verification. An unbound app
  follows the project's OAuth settings (ADR 082 §12).
- **`act` needs an identity.** Only a client with `user_id` can appear as the
  actor of a delegated token.
- **PATs are not client credentials.** They belong to an identity, any kind
  whose schema enables `pat`, and never touch `oauth_clients`.

### Credential hashing

ADR 029 hashes "passwords and secrets" with argon2id. Slow, salted hashes
protect low-entropy values that people reuse elsewhere, and slow down offline
guessing. Neither applies to a server-generated secret of at least 256 random
bits, and a slow hash on the client credentials path turns every bogus request
into CPU load, which was v4's bcrypt problem.

- Generated client secrets and PATs use plain SHA-256. PATs need it unsalted,
  because a PAT arrives without an id and is found by
  `token_hash = sha256(presented)`.
- passwap has no plain SHA-256 hasher (its `sha2` package is the salted
  SHA256-crypt with at least 1000 rounds), so this needs a small
  `passwap.Hasher`, here or upstream in passwap.
- Client secrets get their own `crypto.PasswapHasher`: the SHA-256 hasher
  first, the password verifiers (bcrypt, argon2, scrypt, pbkdf2, …) after it,
  so `VerifyAndRehash` upgrades imported hashes on their first successful use.
- Passwords keep argon2id and the project's hash policy.

### Value prefixes

Generated values carry a type prefix and a checksum:
`<prefix><≥256 random bits, base62><CRC32, base62>`.

- Secret scanners (gitleaks, GitHub push protection) match them with few false
  positives, and support logs and the server can tell a PAT from a client
  secret without a lookup.
- The checksum lets the server and scanners reject typos and random strings
  before hashing. It is not a security control.
- No `:` (it breaks HTTP Basic), URL-safe characters, fixed length.
- Prefixes stay short. `zp_` cannot be reused: it is the retired name of
  `sk_proj_` ([credentials](credentials.md)). The exact strings are open.

Imported and declared secrets keep the customer's value and carry no prefix.

## Variants

Client row is `(app_id, user_id)`; **A** is an app, **I** an identity.

| # | Case | Client row | Credential | Grant | `sub` | `act` |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | User signs into a web app | (A, —) | `client_secrets` or `client_keys` | authorization code + PKCE | user | — |
| 2 | User signs into a SPA, native app or CLI | (A, —), public | none | authorization code + PKCE | user | — |
| 3 | User scripts with a PAT | none | `user_pats` | PAT at the API, or exchanged for a JWT | user | — |
| 4 | Job with a client secret | (—, I) | `client_secrets` | client credentials | I | — |
| 5 | Job with a key | (—, I) | `client_keys` | client credentials, `private_key_jwt` | I | — |
| 6 | Job with JWT bearer | (—, I) | `client_keys` | RFC 7523, `iss` = `client_id` | I | — |
| 7 | Job with a PAT | none | `user_pats` | PAT | I | — |
| 8 | Web app that also acts as itself | (A, I) | the app's | authorization code and client credentials, one `client_id` | user / I | — |
| 9 | API that validates locally | none | none | JWKS | — | — |
| 10 | API that is also the login app, and introspects | (A, —) | the app's | introspection | — | — |
| 11 | API without a login that introspects | (—, I) | the identity's | introspection | — | — |
| 12 | API that calls another API for the user | (—, I) or (A, I) | that client's | token exchange | user | I |
| 13 | Agent acting as itself | (—, agent) | `client_keys` | client credentials or JWT bearer | agent | — |
| 14 | Agent for a user who consents interactively | (A, agent) | the app's | authorization code + consent | user | agent |
| 15 | Agent for a user, non-interactively | (—, agent) | `client_keys` | token exchange | user | agent |
| 16a | MCP client with a client ID metadata document | (A, —), `client_id` is the URL | none, or its `jwks_uri` | authorization code + consent | user | — |
| 16b | MCP client with dynamic registration | (A, —), minted `client_id` | generated secret | authorization code + consent | user | — |
| 17 | Partner backend | (—, partner I), a foreign principal (ADR 053) | `client_keys` | client credentials | partner I | — |
| 18 | Customer API gateway exchanging per backend | (—, gateway I) | `client_keys` | token exchange | user | gateway |

Rows 10–12, 15 and 18 wait for introspection and token exchange; the others
follow ADR 082's sequence.

### Example rows

IDs are shortened.

`users`

| id | schema |
| --- | --- |
| usr_alice | human-user |
| usr_billing_job | service |
| usr_shop_backend | service |
| usr_support_agent | agent |
| usr_v4_reporter | service, imported from v4 |

`oauth_clients`

| id | client_id | client_id_origin | app_id | user_id | Row |
| --- | --- | --- | --- | --- | --- |
| cl_1 | minted | minted | app_shop | usr_shop_backend | 8 |
| cl_2 | minted | minted | app_dashboard | — | 2 |
| cl_3 | minted | minted | — | usr_billing_job | 4 |
| cl_4 | minted | minted | — | usr_support_agent | 13, 15 |
| cl_5 | `reporter` | imported | — | usr_v4_reporter | v4 client credentials |
| cl_6 | `https://claude.ai/oauth/client.json` | metadata_document | app_claude | — | 16a |

`client_secrets`

| client_ref | name | encoded_hash | origin | expires_at |
| --- | --- | --- | --- | --- |
| cl_1 | default | `$sha256$…` | registered | — |
| cl_3 | nightly | `$sha256$…` | registered | 2026-11-04 (rotation overlap) |
| cl_3 | nightly-2 | `$sha256$…` | registered | — |
| cl_5 | imported | `$2a$10$…` (v4 bcrypt), SHA-256 after first use | imported | — |

How requests resolve:

| Request | Lookup | Schema check | Result |
| --- | --- | --- | --- |
| Client credentials with cl_3's id and secret | cl_3 → `client_secrets` | service allows `client_secret` | `sub` = usr_billing_job |
| Client credentials with cl_2's id | cl_2, no `user_id` | — | `unauthorized_client` |
| Authorization code with cl_1's id and secret | cl_1 → `client_secrets` | service allows `client_secret` (cl_1 is bound) | `sub` = usr_alice, `azp` = cl_1's id |
| Client credentials with cl_1's id and secret | cl_1 | the same | `sub` = usr_shop_backend |
| Client credentials as `reporter` with the old secret | cl_5 → bcrypt matches → rehash | service allows `client_secret` | `sub` = usr_v4_reporter |
| A PAT at the orders API | `user_pats` by hash | human-user allows `pat` | `sub` = usr_alice, its scopes ∩ alice's permissions |

## Import

Customers moving from v4, Keycloak, Auth0 or Okta keep their `client_id`s and
secrets so that no client changes. Importing is its own operation permission,
separate from creating a client, and is audited with its origin.

- **`client_id`** is caller-chosen on import: printable ASCII, no `:`, bounded
  length, never in the minted format and never URL-shaped (only metadata
  documents use URLs). It is unique per project, so a declared app may pin it
  and get the same one in every environment. It never changes after create.
- **Secrets** come as plaintext (hashed on import) or as an encoded hash that
  passwap reads (rehashed to SHA-256 on first successful use). Hashes that are
  never used keep their imported format.
- **Weak secrets** are not protected by keeping them slow: a slow hash only
  delays cracking a wordlist value. A short secret is flagged for rotation
  (Console, CLI, audit event) at import or on first use, and a project may
  refuse weak imports.
- **Keys** come as JWKs and keep their `kid`.
- **v4 machine users:** the username becomes the `client_id` of the client
  secret, and the v4 user id the `client_id` of the JWT profile keys, so
  `iss` still matches.
- **Subjects:** an imported user can carry a `legacy_id` that tokens use as
  `sub`, so APIs that stored v4 subjects keep working. Where that is switched
  on (per app, per API) is open, and belongs with pairwise subjects (ADR 082
  open question 2) and SAML NameID in one subject setting.

## Introspection

Not needed for the first slice; this records the direction. ADR 037 rules out
introspection because access tokens are not stored. Introspection only needs
to know whether what a token came from is still live:

1. Verify the JWT (signature, `exp`, `aud`).
2. Check its source: `sid` for a session, a consent or refresh-family id for
   refreshed tokens (a new claim; not called *grant*, which ADR 032 owns), the
   client row and the identity's state for client credentials.
3. A PAT is looked up in `user_pats`.

The caller authenticates exactly as at the token endpoint; the method follows
the credential (`client_secret_basic`, `private_key_jwt`), with no
per-endpoint setting. Who may introspect is the API's decision:

```jsonc
// .zitadel/apis/orders.json
{
  "identifier": "https://api.acme.dev/orders",
  "introspection": { "clients": ["app:shop-web", "identity:svc-orders"] },
  "exchange":      { "clients": ["identity:edge-gateway"] }
}
```

The server answers only for tokens whose `aud` is that API. The project's
OAuth settings may hold defaults for both lists, so one gateway is not listed
in every file.

## Gateways

A customer's API gateway (Kong, Envoy, AWS API Gateway, …) validates JWTs
against JWKS out of the box, introspects with some effort, and rarely
exchanges tokens.

| Pattern | Needs | When |
| --- | --- | --- |
| The gateway is one API; backends validate the forwarded token with the gateway's audience | Nothing new | With ADR 082 |
| Each backend is an API; the gateway validates or introspects | Several resources per consent (below); introspection defaults | With ADR 082, introspection |
| The gateway exchanges its token for one per backend, with `act` = the gateway | Token exchange, `exchange.clients`, delegation | With agents and delegation |

The SDK gets no "trust forwarded claims" mode; backends validate the token
themselves with a configurable audience.

Each access token keeps exactly one audience (ADR 082 rejects several). What
changes is the authorization request: it may name several `resource` values,
so the user consents once, and each token or refresh request then names one
of them (RFC 8707).

## SAML

If an app adds a `saml` block, it gets a `saml_service_providers` row
(`app_id`, `entity_id` unique per project, ACS and SLO endpoints, NameID
setting, attribute map, signing flags) and `saml_sp_certificates` (X.509,
signing or encryption). SP certificates do not go into `client_keys`: they
sign requests and encrypt assertions, they do not authenticate a client.
Identity binding stays on `oauth_clients`, since a SAML SP never acts as
itself.

- Attributes come from the same claims as tokens (`x-claim`, claim rules, the
  claims hook); the `attributes` map only renames them.
- NameID is SAML's `sub` and takes the same subject setting.
- The IdP's endpoints sit on the customer's origin like the OIDC issuer
  (ADR 081). ADR 081 reserves only two `/.well-known/` paths, so adding SAML
  later without changing customer apps needs a reserved path now.
- The project's signing keys (ADR 039) need X.509 certificates, and single
  logout needs per-SP session tracking.

## Impact on existing ADRs and design notes

| Document | Change |
| --- | --- |
| [ADR 082](../../adrs/082-oauth-and-oidc-server.md) §2, §3, sequence step 5 | Drop the `Service` kind; client credentials for identities whose schema allows them; bound apps |
| ADR 082 §3 | The client id is minted by default, importable, or a metadata document's URL |
| ADR 082 §3 | Protocol blocks: `kind` becomes `oidc.type` |
| ADR 082 §5 | Several `resource` values per authorization request, one per token request |
| ADR 082 §7 | A client credentials token's `sub` is the identity's id |
| ADR 082 non-goals | Agent identities move in scope as schema kinds |
| [ADR 081](../../adrs/081-customer-hosted-login-and-oidc-provider.md) | Whether to reserve a SAML path now |
| [ADR 029](../../adrs/029-cryptography-secrets-and-key-lifecycle.md) | Plain SHA-256 for generated secrets and PATs; argon2id stays for passwords |
| [ADR 037](../../adrs/037-token-lifecycle.md) | PATs and introspection move in scope; a consent or refresh-family claim |
| [ADR 036](../../adrs/036-api-credential-planes.md), [ADR 053](../../adrs/053-cross-project-principals.md) §9 | The deferred PAT / service-user ADR is this model: operator-plane automation is a service identity |
| [credentials](credentials.md) | Answers the parked "API keys: CRUD vs client credentials" question; open how bootstrap `sk_proj_` / `sk_team_` tokens relate to identity credentials |
| [identity surface](../cli/identity-surface.md) | `protocol` becomes protocol blocks |
| [glossary](../glossary.md) | *app* as client registration; *identity kinds*; *client* |

## Decisions and open questions

Decided in discussion:

- One identity model in `users`; schema kinds; the API keeps the name `users`.
- Capabilities in `x-auth-methods` with OAuth's names; the schema is the
  ceiling.
- Passwords are interactive only; PATs for any identity whose schema allows
  them.
- An app is a redirect-based client registration; no `Service` kind.
- Client rows keyed by `client_id`, with optional app and optional identity;
  binding never moves a secret; one identity-only client per identity.
- Plain SHA-256 for generated secrets and PATs; imported hashes upgrade on
  first use; weak ones are flagged, not slow-hashed.
- Short value prefixes with a checksum.
- Single-audience tokens; no SDK trust mode for gateways.

Open:

1. **Config → data references.** Declared API files and project defaults name
   identities, which are data. Leaning: developer-owned service identities can
   be declared (`.zitadel/identities/<slug>.json`), and customer-registered
   ones get introspection or exchange rights through an authz grant on the
   API. This also decides how ADR 082's declared services survive without the
   `Service` kind.
2. **Subject setting** (`id`, `legacy_id`, pairwise; SAML NameID): where it is
   set and how the server resolves an incoming `sub` in either form.
3. **Consent or refresh-family claim** for introspection: name and shape.
4. **`x-delegation`**: `act_for`, `delegate_to`, consent requirements, chain
   depth.
5. **Prefix strings**, avoiding the retired `zp_`.
6. **Bootstrap service tokens**: whether `sk_proj_` / `sk_team_` stay their
   own credential class or become credentials of a service identity.
7. **Password grant opt-in**: parked until a migration needs it.
