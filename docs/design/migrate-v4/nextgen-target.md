# Writing nextgen

> Reference for the [`migrate-v4` plan](README.md): where each migrated record
> lands in nextgen, through which code path, and what is missing. Checked
> against nextgen `8b99ba069`. The SQL is under
> [`internal/storage/dialect/postgres/migration/sql`](../../../internal/storage/dialect/postgres/migration/sql).

## 1. Ground rules

- **Services check, statements write.** Services validate and emit events.
  Statements do neither ([events rule](../../../internal/service/AGENTS.md)).
  - The migrator calls a service where one accepts what it has.
  - Otherwise it calls statements inside `StatementPool.Transaction` and emits
    the matching event itself with `audit.Emit`, using a `system` actor.
- **Dual write.** The authz dual write happens inside the statements:
  `CreateUser`, `CreateTeamMembership`, `UpdateTeamMembershipStatus`,
  `DeactivateUser`, `DeleteUserByID` and `DeactivateTeam`
  ([dual_write.go](../../../internal/storage/dialect/authz/dual_write.go)).
  - Never write `users`, `team_memberships` or edge rows with raw SQL
    ([storage rules](../../../internal/storage/AGENTS.md)).
  - A user without its `resource_scope_index` row is unreachable through the
    API.
- **Ids.** Prefixes are `proj`, `team`, `user`, `upw`, `sch`, `idp`,
  `idprev`, `idplink`, `var` and `evt`
  ([ADR 047](../../adrs/047-dialect-id-generation.md)).
  - Mint an id with `Statements().NewManagedID(prefix)`. A non-empty id is
    kept as given.
  - User ids must start with `user_`, because the OpenAPI user-id pattern and
    the grant service require it.
- **Replayable transactions.** A callback must be replayable, because Spanner
  retries the whole closure.
- **Closest precedent.**
  [`internal/bootstrap/users/import.go`](../../../internal/bootstrap/users/import.go)
  validates a hash, then runs `CreateUser` and `SetUserPassword` in one
  transaction under a given id. It emits no events and refuses Spanner.

## 2. Project

- **Create.** `ProjectService.Create` / `CreateWithID`
  ([project.go](../../../internal/service/project.go)) writes, in one
  transaction:
  - the project row;
  - a KEK plus `token`, `secret` and `cookie` encryption keys, and the token
    signing key;
  - the `sk_proj` admin assignment;
  - with `seedDefaults`, the default user schema and login flows;
  - `project.created`.
- **Statement alone is not enough.** The `CreateProject` statement writes the
  row and its scope-index entry only. Always use the service.
- **Claim window.** A project carries a 14-day claim window
  ([claim.go](../../../internal/domain/claim.go),
  [ADR 046](../../adrs/046-claim-lifecycle-v2.md)).

## 3. User schema

- **Storage.** Schemas are immutable rows in `json_schemas` (`000003`), with
  the URL as key. A new revision is a new row with the same `objectType`; the
  newest `created_at` wins.
- **Revision pinning.** A user pins one revision in `users.schema_url`. Sign-in
  matches users across every revision of the flow's `objectType`
  ([user_schema_ref.go](../../../internal/service/user_schema_ref.go)).
- **Create.** `SchemaService.CreateSchema`
  ([schema_service.go](../../../internal/service/schema_service.go)) checks the
  meta-schema and designations ([schema_designation.go](../../../internal/domain/schema_designation.go)):
  - `x-identifier` must be a scalar leaf with `x-unique: "project"`;
  - enabling password sign-in requires an identifier;
  - property names may not contain dots, and `id` and `metadata` are reserved.
- **Uniqueness.**
  - `x-unique` values are hashed after Unicode case folding
    ([attribute.go](../../../internal/domain/attribute.go)).
  - ADR 058's `compare: exact` is not implemented, so `Alice@x` and `alice@x`
    clash.
- **Email and phone verification.** Neither exists.

## 4. Team

- **Table.** `teams` (`000002`, `000011`):
  - names are 1–200 characters, unique per project on `lower(name)`;
  - `status` is `active`, `deactivated` or `pending_purge`.
- **Create.**
  - `TeamService.Create` ([team.go](../../../internal/service/team.go)) always
    mints the id and emits `team.created`.
  - The `CreateTeam` statement keeps a given id. The migrator uses it and emits
    `team.created` itself.
- **Memberships.** `team_memberships` has `(project_id, team_id, user_id)` and
  a `status` of `pending`, `active`, `inactive` or `removed`.
  - There is no role column.
  - Writers: `CreateUser` with an initial team, `CreateTeamMembership`,
    `UpdateTeamMembershipStatus`.
  - No service writes memberships and no event records them.
- **Deactivate.** `DeactivateTeam` deactivates the team, removes its
  memberships and deactivates the users it owns.
  - It refuses a team that owns a project.
  - There is no reactivation.

## 5. IdP connection and its secret

- **Tables.** `idp_connections` holds the fixed `idp_` id and the slug, unique
  per project. `idp_connection_revisions` holds immutable `idprev_` rows with
  the document (`000022`).
- **Document schema.** Defined in
  [`idp-connection.json`](../../../api/openapi/endpoints/schemas/idp-connection.json):
  - OIDC only. Google is `template: google`.
  - `oidc.client_secret` must be a `${{ NAME }}` reference.
  - `scopes` must include `openid`.
  - `pkce_enabled` defaults to true, `subject_claim` to `sub`.
  - `provisioning.creation` is `auto` or `disabled`. There are no linking or
    auto-update options.
  - `protocol`, `subject_claim` and `oidc.issuer` cannot change after creation.
- **Write.** `IDPConnectionService.CreateOrRevise`
  ([idp_connection.go](../../../internal/service/idp_connection.go)) creates or
  revises by slug, validates, and emits `idp.created` or `idp.updated`.
  - There is no delete API ([#1013](https://github.com/zitadel/nextgen/issues/1013)).
- **Served.** Sign-in reads the newest revision by slug, whatever a release
  pins ([flow_sso_provider_resolver.go](../../../internal/service/flow_sso_provider_resolver.go)).
- **Offered.** A slug is offered only by a login step listing it in
  `sso_providers` with a `sso_authenticated` transition
  ([flow_definition_validator.go](../../../internal/domain/flow_definition_validator.go)).
  - Flow definitions are revisioned by name
    ([flow_definition.go](../../../internal/service/flow_definition.go)).
  - With no deployment for the request's origin, the runtime serves the newest
    revision. Otherwise it serves the deployed release
    ([runtime.go](../../../internal/service/runtime.go)).
- **Secret.**
  - `VariableService.SetVariables`
    ([variables.go](../../../internal/service/variables.go)) stores a secret as
    a JWE under the project's `secret` key, in `variables`.
  - The key chain is: master key → project KEK → `secret` key.
  - Rules:
    - names match `^\w+$`;
    - a secret written without a kind goes to `primary` only;
    - sign-in resolves the reference from `primary`;
    - it emits `variable.set`.
- **Callback.** The provider must know `{origin}/__nextgen/idp/{slug}/callback`
  ([flow_sso.go](../../../internal/api/flow_sso.go)). The server also mounts
  `/idp/{slug}/callback` for SDK proxies.
- **Egress.** Issuers on private networks need `httpclient.allow_list`.

## 6. User

- **Tables** (`000004`, `000011`):
  - `users`: status, `lifecycle_owner_team_id` (NULL means self-owned), and
    `schema_url` with an FK on Postgres;
  - `user_attributes`: EAV rows;
  - `user_unique_attributes`: the uniqueness registry.
- **Create.** `UserService.CreateUser` builds a `CreateUserAction`, and
  `ApplyActions` runs several actions in one transaction
  ([user.go](../../../internal/service/user.go)). Together they:
  - validate attributes against the schema;
  - honour `CreateUserInput.ID`;
  - write the initial team membership and its edge;
  - emit `user.created`.
- **Lifecycle owner.** `LifecycleOwnerTeamID` exists only on the statement's
  `domain.CreateUser`; no service or endpoint sets it
  ([ADR 024](../../adrs/024-user-team-lifecycle-ownership.md) amendment). The
  migrator sets it between `Prepare` and `Apply`.
- **Status.** One of `active`, `suspended`, `deactivated` or `pending_purge`.
  - Insert always writes `active` and `created_at = now()`.
  - `DeactivateUser` is statement-only: it sets `deactivated`, removes
    memberships and deletes edges, with no event.
  - `suspended` has no writer.
- **Update.** The `PatchUser` statement rewrites attributes and registry rows,
  guarded by `ExpectedUpdatedAt`.
- **Delete.** `UserService.DeleteUser` hard-deletes through `DeleteUserByID`,
  cascading to everything the user owns, and emits `user.deleted`.

## 7. Password

- **Storage.** `user_passwords` has one row per password; the newest is
  current and the rest is history.
  - The `SetUserPassword{EncodedHash}` statement
    ([user_password.go](../../../internal/storage/dialect/postgres/user_password.go))
    stores a hash as given.
  - `UserService.SetPassword` takes plaintext only.
- **Validation.** Call `PasswapHasher.ValidateHash` first
  ([passwap.go](../../../internal/crypto/passwap.go)). Bounds are enforced only
  there, never at verify.

  | Algorithm | Default bounds |
  |---|---|
  | bcrypt | cost 10–16 |
  | argon2 | t 1–10, m 8–512 MiB, p 1–16 |
  | scrypt | ln 12–20 |
  | pbkdf2 | 100k–5M rounds |
  | sha2-crypt | 5k–1M rounds |

  The values are set in [server.go](../../../cmd/server/server.go).
- **Verifiers.** The defaults are argon2, bcrypt, scrypt, pbkdf2, sha2, md5,
  md5salted, phpass and drupal7. Plain MD5 needs `md5plain` added to
  `password_hasher.verifiers`.
- **No rehash.** Verify discards passwap's upgraded hash, so ADR 038 follow-up 1
  is open.
- **Normalization.** The candidate password is NFC-normalized before verify. A
  v4 hash of a non-NFC password would not match. This is an edge case to note,
  not to solve.

## 8. Identity link

- **Table.** `idp_identity_links` (`000025`): `project_id`, `id`,
  `connection_id`, `subject`, `user_id`.
  - Unique on `(project_id, connection_id, subject)`.
  - The connection FK has no action, so a linked connection cannot be dropped.
  - Deleting the user cascades.
- **Write.** The `CreateIDPIdentityLink` statement
  ([statement.go](../../../internal/service/statement.go)) keeps a given id.
  - Only SSO sign-in calls it, and the event `idp.identity_link.created` is
    emitted there
    ([flow_sso_identity_resolver.go](../../../internal/service/flow_sso_identity_resolver.go)).
  - No service or endpoint creates or deletes links.
- **Matching.** A subject matches exactly and case-sensitively against the
  connection's `subject_claim`.
  - A linked user must use the `objectType` the flow binds, or the link is
    ignored.
  - After a unique-value clash, sign-in binds to the existing user but writes
    no link, so the conflict step returns every time. The migrator
    pre-creates every link to avoid that.

## 9. Gaps

| # | Gap | Where | Effect on the migration | Suggested fix |
|---|---|---|---|---|
| G1 | Sign-in resolves users of any status; status enforcement is deferred | `resolveIdentifier` in [auth_attempt.go](../../../internal/service/auth_attempt.go) | Deactivated or locked v4 users could still sign in | Refuse non-active users at the identifier and SSO bind steps (independent of migration) |
| G2 | Rehash on verify is not persisted | `PasswapHasher.VerifyHash` in [passwap.go](../../../internal/crypto/passwap.go) | bcrypt users stay on bcrypt, and each sign-in computes and drops an argon2id hash | ADR 038 follow-up 1 |
| G3 | No email reset or recovery | [ADR 038 §4](../../adrs/038-user-credential-migration-and-recovery.md), [ADR 050](../../adrs/050-dev-inbox.md) | Users without a usable hash cannot get in | Email code or magic link |
| G4 | No service writes a lifecycle owner, a team under a given id, a membership or a link, and none emits for them | §4, §6, §8 | The migrator writes statements and emits events itself | An internal import service with events (`team.membership.updated` #879) |
| G5 | No user or team reactivation, no link delete, `user.deactivated` not emitted (#878) | §4, §6, §8 | Later runs cannot replay unlock, reactivate or unlink | Statements plus events |
| G6 | The WebAuthn user handle is the nextgen user id | [user_passkey.go](../../../internal/domain/user_passkey.go) | v4 passkeys (handle = v4 id) fail verification. The RP ID follows the request origin | A per-credential legacy handle, the stored `backup_eligible` flag, login served on the v4 RP ID |
| G7 | TOTP and recovery codes are stored raw, with no verifier | `user_totp`, `user_recovery_codes` | v4 secrets have nowhere usable to go | A TOTP check, and encryption under the project `secret` key |
| G8 | No email or phone verification state | §3 | Verified flags become informational attributes | Decide whether verification is a nextgen concept |
| G9 | `created_at` is always `now()` | §6 | Migrated users look new | Optional: accept a creation time on import |
| G10 | Bootstrap import refuses Spanner; Spanner and SQLite lack some FKs and status CHECKs | [ensure.go](../../../internal/bootstrap/users/ensure.go) | Postgres-only target in the POC | Dialect parity when nextgen Cloud becomes a target |
