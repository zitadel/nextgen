# @zitadel/server

## 1.0.0-alpha.21

### Minor Changes

- [#1124](https://github.com/zitadel/nextgen/pull/1124) [`6b59d5a`](https://github.com/zitadel/nextgen/commit/6b59d5a37d731abad0ef05b2699da2a0d860ed89) Thanks [@bastionstack](https://github.com/bastionstack)! - Show each user's teams in the console users list. The memberships ride along on
  `POST /users/query` with `expand: ["teams"]`, so the column costs no request per
  row, and a user on more teams than the embedded list carries says so rather than
  presenting the cap as the whole roster. A credential that may not read
  memberships keeps the list and loses the column.

- [#1085](https://github.com/zitadel/nextgen/pull/1085) [`a59b288`](https://github.com/zitadel/nextgen/commit/a59b288e4e52a3274c1ab4b5e4c241f1083aac6b) Thanks [@livio-a](https://github.com/livio-a)! - Session responses identify their user through a resolved **user ref** derived
  from the user schema's own `x-identifier`/`x-display` designations (ADR 058),
  replacing the convention-resolved flat `name`/`email` fields this supersedes
  (see the earlier `GET /sessions/me` identity changeset). Rendering follows one
  chain everywhere: `display`, falling back to `identifier`, then `user_id`.
  - `@zitadel/server`: `GET /sessions/me`, session get, and query sessions embed
    `user` (`{user_id, identifier, identifier_property, display}`), the list
    path hydrated with one batch resolution per page — listed sessions now carry
    user identity at all. The conventional attribute-name resolver
    (`name`/`givenName`+`familyName`/`email`) is removed.
  - `@zitadel/api`: the regenerated client types the new `user` ref component.
  - `@zitadel/components`: `<zitadel-session>`/`<zitadel-logout>` render from
    the ref; the `zitadel-signout` detail is now `{display, identifier}`;
    logout templates substitute `{{display}}`/`{{identifier}}` (the old
    `{{name}}`/`{{email}}` tokens keep filling as aliases).
  - `@zitadel/sdk-core` (and every SPA SDK via the shared contract):
    `NextgenSession`/`ClientSession` become `{userId, identifier,
identifierProperty, display}`; JWT-claim identities map `name` → `display`
    and `email` → `identifier`.
  - `@zitadel/sdk-next` / `@zitadel/sdk-nuxt`: server and client session reads
    return the new shape.
  - `@zitadel/cli`: scaffolded Nuxt auth plugins emit the new fields.

  **Breaking:** the flat `name`/`email` session fields and the old SDK session
  shape are gone. An unknown property is dropped rather than rejected, so a
  client left on the old fields reads silently empty values instead of failing
  loudly — update server, SDKs, and app chrome together.

- [#1092](https://github.com/zitadel/nextgen/pull/1092) [`7a06425`](https://github.com/zitadel/nextgen/commit/7a06425a1b30a448bf05da8d870bd4570d304060) Thanks [@livio-a](https://github.com/livio-a)! - User responses carry the derived identity of ADR 058 §3a: the envelope
  gains read-only `identifier`, `identifier_property`, and `display`,
  resolved live from each user's own schema designations
  (`x-identifier`/`x-display`) on every read path — query users (one batch
  resolution per page), get by id, `users/me`, and the create read-back.
  Clients render `display`, falling back to `identifier`, then `id`, with
  zero designation logic of their own. The embedded console (shipped inside
  `@zitadel/server`) renders them: the users list gains a leading **User**
  identity column on exactly that chain plus a dedicated role-named
  **Identifier** column (platform-derived, outside the schema-driven column
  set), the user detail heads with the identity, and the console's
  convention-based display-name guesser is removed.

### Patch Changes

- [#1126](https://github.com/zitadel/nextgen/pull/1126) [`21beee0`](https://github.com/zitadel/nextgen/commit/21beee0fe6d6b7df07a05f2bf9b8570bc72d4127) Thanks [@IAM-marco](https://github.com/IAM-marco)! - The server now mints claim and dashboard URLs from a dedicated `server.public_base` setting (env `NEXTGEN_SERVER_PUBLIC_BASE`, default `https://nextgen.zitadel.cloud`) instead of deriving them from the schema identity namespace. Deployments reachable at another origin — a local server most of all — set the new key and `zitadel claim` opens the right console instead of a dead `nextgen.com` address. A misconfigured base (query, fragment, userinfo, or a non-http(s) scheme) now fails at startup instead of leaking into every minted URL.

- [#1090](https://github.com/zitadel/nextgen/pull/1090) [`941645e`](https://github.com/zitadel/nextgen/commit/941645e194c9d2b0d1f0aa484f0c0d518bddafc8) Thanks [@livio-a](https://github.com/livio-a)! - Internal plumbing for ADR 058 §3/§4: the `user-ref` resolution primitives
  (designation readers, `domain.ResolveUserRef`, and the batched
  `(project_id, user_ids) → refs` resolution port) and the inert `user-ref`
  wire component. No endpoint behavior changes yet — session adoption ships
  separately.

## 1.0.0-alpha.20

### Major Changes

- [#982](https://github.com/zitadel/nextgen/pull/982) [`c1ee831`](https://github.com/zitadel/nextgen/commit/c1ee83117f22e50885bf551740ba5719832c0bc9) Thanks [@vitorbari](https://github.com/vitorbari)! - Remove `GET /users`. `POST /users/query` replaces it, matching projects and
  teams, which have no `GET` collection either. Callers move from
  `listUsers({ limit, page_token })` to `queryUsers({ limit, page_token })`,
  which additionally accepts `filter` and `sorting`.

### Minor Changes

- [#981](https://github.com/zitadel/nextgen/pull/981) [`c8dfb1f`](https://github.com/zitadel/nextgen/commit/c8dfb1f3d64d10c9535184994a6221a5a159d103) Thanks [@vitorbari](https://github.com/vitorbari)! - Add `POST /users/query`, the structured-filter user list. Filter and sort by
  `created_at`, `id`, `schema`, `status`, or `lifecycle_owner_team_id`, paginated
  with the same cursor contract as the other query endpoints. Unlike them it
  takes no `project_id` — the users list is bound to the token's own project.

- [#1070](https://github.com/zitadel/nextgen/pull/1070) [`cb6894d`](https://github.com/zitadel/nextgen/commit/cb6894dc8763758a785c775d5fa7c6fa80d1181d) Thanks [@IAM-marco](https://github.com/IAM-marco)! - `POST /projects/{project_id}/claim/complete` now distinguishes two reasons for its 403. `claim.no_personal_team` still means the user holds no team membership at all, which clears itself because the next sign-in provisions one. The new `claim.personal_team_not_active` means the membership exists but is not active, so provisioning will not clear it, and `details.details.membership_status` says which state it is in: `removed` (withdrawn by deactivating the team or the user, so someone has to restore the user's access — the team itself may still be active), `inactive` (suspended), or `pending` (an unaccepted invitation). Clients can branch on the code to stop offering one message for both, and on the status to say what would actually clear it. The 403 response is now a `oneOf` over the two codes discriminated on `code`, so generated clients get a variant per code instead of typing every 403 as the old one.

- [#1078](https://github.com/zitadel/nextgen/pull/1078) [`bb8b010`](https://github.com/zitadel/nextgen/commit/bb8b0102145ee9ed75fc3e334185478a656ed4f1) Thanks [@peintnermax](https://github.com/peintnermax)! - The console serves the project claim page at `/claim`: a developer opening a claim link authenticates through the platform login widget and the project is attached to their personal team, with explicit outcomes for an expired, already-claimed, or unauthorized challenge instead of a redirect loop.

- [#1075](https://github.com/zitadel/nextgen/pull/1075) [`309ae57`](https://github.com/zitadel/nextgen/commit/309ae57e20145b6417d77726624e7ceb6c1a288b) Thanks [@wim07101993](https://github.com/wim07101993)! - Projects now carry **environments** — the runtime slots a release is deployed onto (ADR 035). Two read endpoints ship: `GET /environments` lists a project's environments by name, and `GET /environments/{name}` reads one by its project-unique name, which is the handle a deploy target is already known by.

  Environments are identity only for now: `{ id, project_id, name, created_at }`, with no link to a release yet. Because there is no create endpoint, every project — new or created through the CLI — is seeded with `dev`, `staging` and `prod` at creation, and the set cannot be changed until environment lifecycle lands. Existing projects are not backfilled.

  Seeding emits one `environment.created` audit event per environment.

- [#1071](https://github.com/zitadel/nextgen/pull/1071) [`b1a4899`](https://github.com/zitadel/nextgen/commit/b1a489967af31962f4eba834f64f9825f4e525e3) Thanks [@vitorbari](https://github.com/vitorbari)! - `POST /users/query` accepts `expand: ["lifecycle_owner_team"]`, which resolves
  each user's `metadata.lifecycle_owner_team_id` into the team itself at
  `metadata.lifecycle_owner_team`. It is the same body `GET /teams/{team_id}`
  serves, so a list of users renders its owning teams without a request per user.

  The property is absent when not requested and `null` when the user is
  self-owned. Expanding it requires `team.read` in addition to `user.read`; the
  id alone stays unconditional.

- [#984](https://github.com/zitadel/nextgen/pull/984) [`b2a74e4`](https://github.com/zitadel/nextgen/commit/b2a74e49eb44448c4c2203ce5642698c45ef8863) Thanks [@vitorbari](https://github.com/vitorbari)! - Embed a user's team memberships on `POST /users/query` with
  `expand: ["teams"]`, saving a request per user. The property is omitted when
  not requested and `[]` when the user has none. Embedded lists are capped at 10
  with `teams_truncated`; the whole list stays at `GET /users/{user_id}/teams`.

- [#983](https://github.com/zitadel/nextgen/pull/983) [`25c1802`](https://github.com/zitadel/nextgen/commit/25c1802a9df257d7eca1a2469cb4caf389118a25) Thanks [@vitorbari](https://github.com/vitorbari)! - Filter users by team: `POST /users/query` accepts a `team_id` filter field,
  restricting the result to users holding an active membership in that team.
  `equals` only, and it may be given once. It is filterable but not sortable.

  As everywhere on the user endpoints, `team_id` is membership, not lifecycle
  ownership — `lifecycle_owner_team_id` is a separate filter field answering a
  different question: which team may deprovision the user.

- [#1079](https://github.com/zitadel/nextgen/pull/1079) [`7910305`](https://github.com/zitadel/nextgen/commit/79103051d4fa05897fa63f4e4a87dcdfd0b0b37f) Thanks [@IAM-marco](https://github.com/IAM-marco)! - `GET /flow-definitions` accepts `expand=user_schema` and embeds each flow definition's user schema on the entry, the same object `GET /schemas/{id}` returns, so a directory shows schema names from one request instead of one schema request per flow. The property is omitted when not requested and `null` when the referenced schema cannot be resolved or read; an unknown expand value is rejected with a 400. Expansion changes neither ordering nor page tokens.

- [#986](https://github.com/zitadel/nextgen/pull/986) [`b1bcc37`](https://github.com/zitadel/nextgen/commit/b1bcc3740fe780297761baaf69f9df403927efcc) Thanks [@grvijayan](https://github.com/grvijayan)! - `GET /flow_definitions` now returns each row as the same `{id, project_id, flow_definition, created_at, updated_at}` representation that `GET /flow_definitions/{id}` returns, so a list row carries the flow's name, status, user schema, purposes and steps. The flat summary it returned before is gone, and with it the `schema_uri` field, which the response declared but the server never populated. Clients that read `name` or `status` from the top level of a list row must read them from `flow_definition`.

  `POST /flow_definitions` and `PUT /flow_definitions/{id}` now return the `created_at` and `updated_at` the database wrote. Both answered with zero timestamps before.

- [#988](https://github.com/zitadel/nextgen/pull/988) [`0a9a5af`](https://github.com/zitadel/nextgen/commit/0a9a5afd0336382ca8ebef9c646f09acde2d7ada) Thanks [@livio-a](https://github.com/livio-a)! - Login flows resolve the identifier from the schema's designation: a flow field carries the identifier challenge only when it names the schema-root `x-identifier` property. Other unique properties keep their uniqueness for storage but are no longer treated as login identifiers.

- [#1004](https://github.com/zitadel/nextgen/pull/1004) [`b94e797`](https://github.com/zitadel/nextgen/commit/b94e79767e84e1898f6ffe0f97e9c629a3788f86) Thanks [@vitorbari](https://github.com/vitorbari)! - Reading a user's team memberships now requires `team_membership.read` on top of
  `user.read`, on every surface that serves them: `GET /users/{user_id}/teams`,
  and `POST /users/query` when `expand` asks for `teams` or a filter selects on
  `team_id`. Requesting any of them without it answers `403` rather than quietly
  omitting the data or serving the filtered page.

  Granular scopes are not minted yet, so an operator project secret satisfies the
  requirement for now; browser-plane preview secrets do not.

- [#1026](https://github.com/zitadel/nextgen/pull/1026) [`3474d05`](https://github.com/zitadel/nextgen/commit/3474d05856a796cd1bb8b9b20ac1d49312b5c149) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Add grant create, get, and revoke APIs for project viewer/editor/admin bindings.

- [#913](https://github.com/zitadel/nextgen/pull/913) [`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b) Thanks [@bastionstack](https://github.com/bastionstack)! - feat: the sign-in and sign-up surface is rebuilt on the shadcn design language. The card, fields, buttons, alert and trustmark are re-cut to the shadcn geometry and re-keyed onto the shadcn token roles, so every colour now comes from a semantic `--zl-*` role and light mode falls out of the token layer. Form-level alerts move below the fields, forgot-password moves onto the password field's label row, and headings and labels are set in the display face. Tenant branding, the `part`/`exportparts` hooks and `suppress-header` are unchanged.

- [#951](https://github.com/zitadel/nextgen/pull/951) [`0fa2e45`](https://github.com/zitadel/nextgen/commit/0fa2e45fe265e0f90c68c664c3c460cbc85781ea) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Passkeys can now be registered through the management API: `POST
/users/{user_id}/passkeys` (scope `user.write`) starts a WebAuthn ceremony and
  returns the creation options, and `POST
/users/{user_id}/passkeys/{registration_id}` verifies the attestation and
  stores the credential with an optional display name. Combined with `POST
/users` and `PUT /users/{user_id}/password`, backends can provision users with
  either credential type without going through the hosted login flow.

- [#979](https://github.com/zitadel/nextgen/pull/979) [`3017d95`](https://github.com/zitadel/nextgen/commit/3017d95238f8d7bf05b4f0426c57c83b33872e7a) Thanks [@peintnermax](https://github.com/peintnermax)! - Deployments that opt into the platform plane via `platform.bootstrap_project` provision their users a personal team: every session exchange ensures the team and its membership, so a freshly registered developer can complete a project claim without manual seeding, and users created before this change converge on their next sign-in. Provisioning is best-effort and never fails the sign-in, so a session can briefly exist before its team does; `claim/complete` answers `claim.no_personal_team` until the next exchange, which retries. Standalone deployments that merely pin `platform.project_id` are unaffected.

  `platform.bootstrap_project` now seeds a usable project rather than a bare row: encryption and signing keys, the default user schema, and the default login flow definitions are created with it, so a bootstrapped platform project can serve the registration and sign-in the platform plane exists for.

  **Upgrade note for existing `platform.bootstrap_project` deployments.** The previous bootstrap created the platform project as a bare row with none of that, and there is no way to seed one in place yet. The server therefore refuses to start when it finds a platform project without an active token encryption key, rather than booting into a project that cannot serve a registration. If you hit this, unset `platform.bootstrap_project` **and** set `platform.project_id` to `proj_platform`, which starts with the pre-upgrade behaviour; track in-place seeding under [#527](https://github.com/zitadel/nextgen/issues/527). Set both, not just the flag: with neither set, the default project falls back to the earliest-created one, which silently repoints console and claim routing away from the platform project unless it happened to be created first. Do not delete the platform project to force a reseed: deletion cascades to its users, teams, schemas, sessions, and grants.

- [#1088](https://github.com/zitadel/nextgen/pull/1088) [`79ea448`](https://github.com/zitadel/nextgen/commit/79ea4487b59f293f6306528c9199a6c57837f5cc) Thanks [@vitorbari](https://github.com/vitorbari)! - The API contract gains **releases** — immutable, project-scoped configuration snapshots. A release pins one revision of each resource it includes and records who assembled it, from what commit, and why; it carries pointers and metadata, never resource content.

  Three endpoints are described: `POST /releases` bundles a release from revision ids that already exist, `GET /releases` lists a project's releases newest first with the pinned set omitted, and `GET /releases/{release_id}` reads one release with its pointers.

  `POST /releases` is idempotent on the pinned set — metadata is excluded from the comparison, so re-submitting the same revisions with a different message answers `200` with the release that already pins them instead of `201` and a duplicate.

  This ships the contract and the generated clients only. The endpoints answer `501` until the implementation lands.

- [#964](https://github.com/zitadel/nextgen/pull/964) [`d7aefb3`](https://github.com/zitadel/nextgen/commit/d7aefb3020cf7fb32cfc89229fb379c320ad5898) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Record observed requestor IP, User-Agent, and Origin on Path A `request.api` event metadata so SIEM pipelines can join mutations via `request_id`.

- [#987](https://github.com/zitadel/nextgen/pull/987) [`4a8d546`](https://github.com/zitadel/nextgen/commit/4a8d546d8abd6902f2e19c50e8b980f91451bbfd) Thanks [@livio-a](https://github.com/livio-a)! - User schemas can now declare their identity: the schema-root `x-identifier` keyword names the leaf property whose value identifies a user, and `x-display` lists the property paths that render the display name. Inline schema uploads validate the designations — every designated property must exist and declare a scalar type, the identifier must additionally be unique within the project, and a schema that enables password authentication must designate an identifier, since password verification is unreachable without one. The shipped default human-user schema designates `email`.

- [#932](https://github.com/zitadel/nextgen/pull/932) [`2bd640d`](https://github.com/zitadel/nextgen/commit/2bd640d920f4c30eb711a101640da9563e6cef6f) Thanks [@vitorbari](https://github.com/vitorbari)! - `GET /schemas` accepts a `kind` query parameter, so you can list only the user schemas in a project instead of every schema document it has stored. The console's User schemas screen now uses it.

  The `schema.created` audit event carries the schema's kind and object type, where it previously carried an empty payload.

- [#930](https://github.com/zitadel/nextgen/pull/930) [`1ef3c32`](https://github.com/zitadel/nextgen/commit/1ef3c32fd6fa7091f2300fa9e210f43040dbd143) Thanks [@IAM-marco](https://github.com/IAM-marco)! - `GET /schemas` and `GET /schemas/{id}` now return each schema as an `{id, schema, metadata}` envelope carrying the full customer-authored document, and `GET /schemas` wraps its rows in a `{schemas: [...]}` object. The two read endpoints share one representation; the resource `id` and `metadata.created_at` are server-owned and can no longer collide with keys in the document. Clients that read the bare document from `GET /schemas/{id}` or the bare `{id, created_at}` array from `GET /schemas` must unwrap the envelope.

- [#946](https://github.com/zitadel/nextgen/pull/946) [`78915e0`](https://github.com/zitadel/nextgen/commit/78915e0595901fd134ec92f7074ca37cb6a7ddbe) Thanks [@IAM-marco](https://github.com/IAM-marco)! - `GET /schemas` now pages by cursor: it takes `limit` (default 20, max 100) and `page_token`, returns `next_page_token`, rejects malformed or mismatched page tokens with `req.invalid`, and drops the never-implemented `offset` parameter.

- [#957](https://github.com/zitadel/nextgen/pull/957) [`14cc4df`](https://github.com/zitadel/nextgen/commit/14cc4dff9424e0ec8024f1821786b0967930505b) Thanks [@vitorbari](https://github.com/vitorbari)! - `GET /schemas` takes a `revisions` parameter: `all` (the default) keeps returning every revision, and `latest` returns the newest revision of each `objectType` — one row per schema. Schemas stored without an `objectType` are returned by both. A `page_token` is bound to the mode it was issued in and is rejected by the other, and the console's user-schema directory and add-user picker now show one row per schema rather than one per edit.

- [#947](https://github.com/zitadel/nextgen/pull/947) [`19fc783`](https://github.com/zitadel/nextgen/commit/19fc7835e23d04da9c458bda2fda39c4aa9dbc00) Thanks [@IAM-marco](https://github.com/IAM-marco)! - The console's schema directory now pages through `GET /schemas` with a `Load more` button, and `zitadel schemas list` walks every page so the printed revision history stays complete.

- [#976](https://github.com/zitadel/nextgen/pull/976) [`b8b5b97`](https://github.com/zitadel/nextgen/commit/b8b5b970c6cf99d2e60b55737fce860876b16577) Thanks [@muhlemmer](https://github.com/muhlemmer)! - Filter sessions by team on `POST /sessions/query`. The new `lifecycle_owner_team_id` filter field returns the sessions of the users whose lifecycle that team owns — the same users it can deactivate and whose sessions it can revoke. Roster membership does not match: a collaborator on the team's roster whose lifecycle another team (or the user themselves) owns is not returned. A session stays project-scoped and carries no team, so the link is read from the user at query time; a session of a self-owned user, and a session with no user, match no team.

  The change also ships an index-only schema migration: `sessions` gains `(project_id, created_at, id)` and `(project_id, user_id)`, and on SQLite `users` gains the lifecycle-owner index the other dialects already had. It adds no column or table, but it does close a pre-existing gap — before it, every page of `POST /sessions/query` scanned and sorted a project's whole session table (127 ms for an unfiltered first page at 2M sessions, against 0.44 ms after). On PostgreSQL the indexes are built `CONCURRENTLY`, so upgrading does not block session creation or exchange.

- [#950](https://github.com/zitadel/nextgen/pull/950) [`2a0623b`](https://github.com/zitadel/nextgen/commit/2a0623bfc5f045905de8930fe45aeadf3de10f78) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Sessions created by sign-up now record how the user authenticated: registering
  with a passkey yields a session with a verified passkey factor, and registering
  with a password yields one with a verified password factor. Passkey sign-up
  also became atomic — if the chosen identifier is already taken, the flow now
  routes to `user_already_exists` (matching the password path) instead of
  silently attaching the credential, and no partial user is left behind. The
  `pkreg.not_found` error code disappeared from `POST /flow/{id}/submit`; an
  expired or unknown registration ceremony now surfaces as `att.stale_challenge`.

### Patch Changes

- [#912](https://github.com/zitadel/nextgen/pull/912) [`67b3c5a`](https://github.com/zitadel/nextgen/commit/67b3c5a354c49fa066c96d1ce93421e6efadd9df) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Wire the claim init/status/complete endpoints to the claim service (ADR 046): challenge tokens now use the contract's `ch_` wire prefix, the 409 already-claimed response carries flat `details.{team_id, dashboard_url}`, and the API handler resolves the platform-project pin in bootstrap mode so claim/complete accepts platform sessions.

- [#945](https://github.com/zitadel/nextgen/pull/945) [`2f1b2f4`](https://github.com/zitadel/nextgen/commit/2f1b2f4dce2ca5c1c9582e9737ca143d1bc97177) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Completing a project claim as a user without an active personal team now returns a clear 403 with code `claim.no_personal_team` instead of a 500, and owning-team grants can no longer be created with an expiry: project ownership ends only by explicit transfer or revocation, never by lapse.

- [#912](https://github.com/zitadel/nextgen/pull/912) [`67b3c5a`](https://github.com/zitadel/nextgen/commit/67b3c5a354c49fa066c96d1ce93421e6efadd9df) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Derive claim state from the active owning-team grant instead of a denormalized resource-scope team marker (ADR 054): claim/complete writes only the authz_assignments grant, claim status and events visibility read it, and a per-dialect uniqueness guarantee (partial unique index on Postgres/SQLite, NULL_FILTERED owning_team_key index on Spanner) keeps at most one active owning team per project, closing the double-claim race.

- [#931](https://github.com/zitadel/nextgen/pull/931) [`d997952`](https://github.com/zitadel/nextgen/commit/d997952eb28ebb1ea81b3291ef8b632a828f0eb4) Thanks [@IAM-marco](https://github.com/IAM-marco)! - The console renders the schema directory and the add-user schema picker from the single `GET /schemas` response instead of fetching every schema's document individually.

- [#980](https://github.com/zitadel/nextgen/pull/980) [`c8288b5`](https://github.com/zitadel/nextgen/commit/c8288b58d8370fb1e60ad366e394e6c575d9ed49) Thanks [@vitorbari](https://github.com/vitorbari)! - Document what `team_id` does on the user endpoints. On `POST /users` it adds
  the new user to that team and scopes team-unique attributes; on
  `GET /users/{user_id}` it serves the user only when they hold an active
  membership there. Both are membership, not lifecycle ownership — which is
  reported as `metadata.lifecycle_owner_team_id` and cannot be set through the
  API. No request or response shape changed.

- [#1086](https://github.com/zitadel/nextgen/pull/1086) [`3f3dd43`](https://github.com/zitadel/nextgen/commit/3f3dd4312b52b90e3cb96d01826b488f55a1dcab) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Fix embedded default-login-flow seeding dropping each transition's `purpose`
  field, which left the login flow's Sign Up link unable to switch the flow
  into registration mode.

- [#1036](https://github.com/zitadel/nextgen/pull/1036) [`7d27c9c`](https://github.com/zitadel/nextgen/commit/7d27c9cdf26230f02e34b10169df98f958c4dae1) Thanks [@wim07101993](https://github.com/wim07101993)! - `GET /flow_definitions` now bounds its result set. A request that omits `limit` returned every flow definition in the project; it now returns the same default page of 20 as the other list endpoints, capped at 100, and hands back a `next_page_token` to walk the rest.

- [#960](https://github.com/zitadel/nextgen/pull/960) [`ad19e29`](https://github.com/zitadel/nextgen/commit/ad19e29957bd8d4caf146ae87d6e3775e582cd87) Thanks [@livio-a](https://github.com/livio-a)! - Login identifier lookups now match only uniquely-registered attribute values. Previously, an equal value stored under the same key as a non-unique attribute of another user (for example a notification email address) made the lookup ambiguous and rejected the legitimate user's sign-in.

- [#970](https://github.com/zitadel/nextgen/pull/970) [`6098080`](https://github.com/zitadel/nextgen/commit/609808008e5be1159f7eadf3d904de52c9ea3b70) Thanks [@livio-a](https://github.com/livio-a)! - Unique attribute values are now compared case-insensitively (Unicode case folding): `Alice@Example.com` and `alice@example.com` register as one unique value and resolve to the same user at sign-in regardless of typed casing. Stored attribute values keep their original casing.

## 0.1.0-alpha.19

### Minor Changes

- [#807](https://github.com/zitadel/nextgen/pull/807) [`c0b5a68`](https://github.com/zitadel/nextgen/commit/c0b5a6867d457d3cea495293b43584ce47af7f7b) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Gate in-project management APIs through the authz permission resolver (403/404 by foothold) and seed sk_proj grants on CreateProject so the project secret can set up the project.

- [#894](https://github.com/zitadel/nextgen/pull/894) [`46ccc08`](https://github.com/zitadel/nextgen/commit/46ccc080befcd6f1401248f1a891e37c0d1d8626) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Management list endpoints now return a filtered view when the caller has a project foothold but only a team- or resource-scoped grant, instead of HTTP 403.

- [#811](https://github.com/zitadel/nextgen/pull/811) [`982e885`](https://github.com/zitadel/nextgen/commit/982e8853b94a748c420ddf2614206225ae76eb94) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Inject an authz EXISTS list predicate into management list queries after a successful project-level Check. The predicate enforces RSI-backed visibility / TOCTOU for principals that already passed the gate. Team-scoped HTTP list narrowing is not live yet; SQL + stmttest are the substrate for a follow-up ([#834](https://github.com/zitadel/nextgen/issues/834)).

- [#801](https://github.com/zitadel/nextgen/pull/801) [`20ad1fe`](https://github.com/zitadel/nextgen/commit/20ad1fe1fd369688676d939d9eda9adf94ef7330) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Add the authz permission resolver library (Check / ListObjects), storage statements, and L4 oracle tests across Postgres, Spanner, and SQLite.

- [#809](https://github.com/zitadel/nextgen/pull/809) [`6904475`](https://github.com/zitadel/nextgen/commit/690447504a4a1a524074103c7d28c4332711c4bd) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Dual-write schema, branding, flow definition, and session creates into resource_scope_index so flat-by-id permission checks can resolve project scope for those path ids.

- [#810](https://github.com/zitadel/nextgen/pull/810) [`a0c8f7a`](https://github.com/zitadel/nextgen/commit/a0c8f7ab8b7646e10a2d1ecc73e2594eb64957cc) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Resolve path-id management API scope from resource_scope_index before the permission check, and drop the required project_id query parameter from by-id operations. The CLI sync/setup path matches that contract and no longer sends project_id on get/update/delete by id.

- [#893](https://github.com/zitadel/nextgen/pull/893) [`a869184`](https://github.com/zitadel/nextgen/commit/a86918457a25755974c24066307724f50dd77077) Thanks [@adlerhurst](https://github.com/adlerhurst)! - A team- or resource-scoped grant can now authorize a by-id management read or write when the resource lives in that team (or is the granted resource). Creating project-wide resources still requires a project-scoped grant.

- [#785](https://github.com/zitadel/nextgen/pull/785) [`215ca5c`](https://github.com/zitadel/nextgen/commit/215ca5c7cb6d179424469308f5aac33d809af3c8) Thanks [@vitorbari](https://github.com/vitorbari)! - Flow steps can now collect nested user-schema properties by their dotted path,
  for example `"fields": ["address.street"]`. The field renders like any other
  scalar input and its value is stored under the same `address.street` attribute
  key the user API already uses, so it reads back as a nested object.

  A nested field is only marked required when every object above it is required
  too, and a required object is satisfied by collecting one of its leaves: a
  schema declaring `required: ["address"]` with `address.required: ["street"]` is
  satisfied by a step collecting `address.street`. Collecting into an _optional_
  object brings its own `required` list into force for the same reason — the
  object exists in the document only because one of its leaves was collected, so
  a step collecting `shipping.city` must collect `shipping.street` too. Naming an
  object- or array-typed property directly is rejected when the flow definition is
  saved instead of failing part way through the flow.

- [#816](https://github.com/zitadel/nextgen/pull/816) [`c4d9c76`](https://github.com/zitadel/nextgen/commit/c4d9c76e5ca0f15b41ffabb6383f4f77187abacd) Thanks [@bastionstack](https://github.com/bastionstack)! - The console now has Projects screens. The directory lists the projects it can see with their creation date, and opening one shows its id and creation date beside the name, where the name can be edited and saved. Projects returns to the sidebar as a designed screen rather than a key/value view reachable only by URL.

- [#914](https://github.com/zitadel/nextgen/pull/914) [`d5ba4d2`](https://github.com/zitadel/nextgen/commit/d5ba4d268a84c57ced65ef8cbb99735c108617de) Thanks [@bastionstack](https://github.com/bastionstack)! - The console's Teams directory can be searched by name and filtered by status. Search matches part of a name, ignoring case, across every team in the project rather than only the page on screen; the `Active` and `Deactivated` tabs narrow the list the same way. Both are kept in the page's address, so a filtered list can be linked, reloaded, and stepped back through.

- [#813](https://github.com/zitadel/nextgen/pull/813) [`659ad19`](https://github.com/zitadel/nextgen/commit/659ad192b4defde50ea326e46e63663b01ff29d1) Thanks [@bastionstack](https://github.com/bastionstack)! - The console now has Teams screens. The directory lists every team in the project with its status and creation date, walking the rest with `Load more`. Opening a team shows its id and creation date beside the name, and its name can be edited and saved. `Add` opens a drawer that creates a team. Search and the status tabs are not built yet: the team query endpoint filters on creation date only, so both would narrow the loaded page while appearing to narrow the whole set.

- [#808](https://github.com/zitadel/nextgen/pull/808) [`72cfb92`](https://github.com/zitadel/nextgen/commit/72cfb928e78a96b7d47bac217f13ec8cb603851a) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Add `GET /events` and `GET /events/{id}` for project audit events. List is newest-first by default (`order=desc`); pass `order=asc` for oldest-first. Callers need `events.read` (or the transitional `project.write` umbrella); pre-claim projects return an empty list or 404 until claim stamps the project team. Login/flow HTTP and `POST /projects` emit `request.api` when `project_id` is known. Path B events copy `request_id` from the HTTP request even without a token. `createFlow` stamps `flow_id` before `auth.attempt.created` so both events share it.

- [#900](https://github.com/zitadel/nextgen/pull/900) [`e26f376`](https://github.com/zitadel/nextgen/commit/e26f37617f5d3a3f92f00c07aad89a98ee9d754f) Thanks [@vitorbari](https://github.com/vitorbari)! - Nest a user's schema-defined content under `attributes`. `POST /users` takes `schema` plus an `attributes` document, and every user response carries `id`, `schema`, `attributes` and `metadata`. The user schema now validates `attributes` alone, so closed-world keywords such as `additionalProperties: false` behave as their author intended and a schema may declare a property named `id` or `metadata`. The schema pointer is named `schema` rather than `$schema`, and `POST /users` answers with the same representation a read returns.

  A user is stored as its attribute rows, so an empty `attributes` document is
  rejected with `user.invalid`, even where the schema itself accepts it. `POST
/users` also documents its `500`: when the user was created but could not be
  read back, the body carries its id in `details.user_id`, and the caller should
  fetch that user rather than repeat the create.

- [#806](https://github.com/zitadel/nextgen/pull/806) [`a5efd98`](https://github.com/zitadel/nextgen/commit/a5efd985176dc67884c5eae2b80963e64ad05783) Thanks [@grvijayan](https://github.com/grvijayan)! - `POST /sessions/query` now returns real results instead of not-implemented. Filter on `created_at`, `user_id`, and `state`, sort on `created_at` or `user_id` (newest first by default), and page with `limit` and `page_token`.

- [#848](https://github.com/zitadel/nextgen/pull/848) [`c470f07`](https://github.com/zitadel/nextgen/commit/c470f0741df9a767fda0930b8cb63a3ad607674b) Thanks [@grvijayan](https://github.com/grvijayan)! - Add `name` and `status` as filter and sort fields on `POST /teams/query`. A `name` filter matches case-insensitively with both `equals` and `contains`, because team names are unique per project case-insensitively. `status` filters on the contract's two values, `active` and `deactivated`.

  `contains` on a text field is now a case-insensitive substring match on every query endpoint, not only on teams.

  Teams pending purge no longer surface through the API: `getTeam` answers 404 for them, and `queryTeams` omits them. They previously read as `deactivated`.

- [#852](https://github.com/zitadel/nextgen/pull/852) [`0e8ac0c`](https://github.com/zitadel/nextgen/commit/0e8ac0c41c6e958fe3fc52eee8750381a8a16919) Thanks [@bastionstack](https://github.com/bastionstack)! - The account menu at the bottom of the console sidebar now opens a settings area with its own sidebar view and a row back to the portal. Both views are available expanded and collapsed.

- [#901](https://github.com/zitadel/nextgen/pull/901) [`433f81c`](https://github.com/zitadel/nextgen/commit/433f81cffc3e3e8499c555aa45b2a45aa557916f) Thanks [@vitorbari](https://github.com/vitorbari)! - User schemas can now declare `x-audit: true` on a property, allowlisting that
  attribute's value for audit event payloads. Payloads stay deny-by-default:
  without it, an attribute contributes its key but never its value.

  `x-verify`, `x-editable`, `x-sensitive` and `x-mfa` are no longer part of the
  dialect. Nothing read them. A schema that still carries one keeps validating,
  since a property accepts annotations the dialect does not name, but they are no
  longer documented or offered by editor completion.

- [#808](https://github.com/zitadel/nextgen/pull/808) [`72cfb92`](https://github.com/zitadel/nextgen/commit/72cfb928e78a96b7d47bac217f13ec8cb603851a) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Align Events API Path B payloads: create snapshots and update deltas use shared allowlisted fields (including project preview_origins and user attribute_keys / x-audit attributes); auth checks carry auth_attempt_id for SIEM join; attempt and schema create payloads stay empty with identity on event columns.

### Patch Changes

- [#875](https://github.com/zitadel/nextgen/pull/875) [`d1e967d`](https://github.com/zitadel/nextgen/commit/d1e967d74ee339f9695f73185dd3097b19f527a2) Thanks [@fforootd](https://github.com/fforootd)! - The login widget now uses clearer identifier-step copy and avoids misleading initial focus:
  - The identifier step's primary button now says "Continue" ("Weiter" /
    "Continua") instead of "Sign in". The step branches to registration when
    the email is unknown, so "Sign in" promised an outcome the step cannot
    guarantee.
  - The widget no longer paints a focus ring on the primary action when a
    page-mode flow loads on a field-less step (e.g. the passkey-first
    preset's entry step). Script-moved focus with no prior interaction
    matches `:focus-visible`, which made the ring read as a pre-selected
    state. Initial focus now lands only on input fields; step swaps keep
    moving focus to the first control, where the browser derives the ring
    from the user's actual input modality.

- [#896](https://github.com/zitadel/nextgen/pull/896) [`e146a1e`](https://github.com/zitadel/nextgen/commit/e146a1ee1da307d57285ec6c7ddafeda155e339f) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Management lists skip the authz EXISTS filter for one compile when Check already returned project-wide Allow. That skip does not re-check RSI dual-write, and a grant revoked between Check and SELECT can still appear. Forbidden lists still get the EXISTS partial view.

- [#895](https://github.com/zitadel/nextgen/pull/895) [`7f44430`](https://github.com/zitadel/nextgen/commit/7f44430c35ffbb01a14666dd43c38f0a88647482) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Management list queries now fail closed if the authz list filter is missing from the request, instead of returning every row in the project.

- [#890](https://github.com/zitadel/nextgen/pull/890) [`051ed71`](https://github.com/zitadel/nextgen/commit/051ed7162e58a0ff9fc3c488f9c747925b376b6d) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Management APIs no longer treat session, OIDC, or PAT bearers as the project secret. Only project and preview tokens mint an `sk_proj` principal. Pre-[#760](https://github.com/zitadel/nextgen/issues/760) project secrets with no Type field (`TokenTypeUnspecified`) also stop authenticating.

- [#891](https://github.com/zitadel/nextgen/pull/891) [`15fe470`](https://github.com/zitadel/nextgen/commit/15fe4707660fe2a8f62c64e5ee59e957bc3703c6) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Team service principals (`sk_team_`) can no longer act on users or teams outside the token's team, even if a project-wide grant exists. Project-scoped team-bound grants are rejected at mint time. HTTP wiring for the constraint lands in the stacked follow-ups ([#893](https://github.com/zitadel/nextgen/issues/893)–[#895](https://github.com/zitadel/nextgen/issues/895)).

- [#874](https://github.com/zitadel/nextgen/pull/874) [`c2888bd`](https://github.com/zitadel/nextgen/commit/c2888bdfd3c2a21fefd76a9b7fa80507d97cd88b) Thanks [@fforootd](https://github.com/fforootd)! - Branding asset URLs (`logo_url`, `hero_url`) may now use plain `http://` with canonical loopback hosts (`localhost`, dotted-decimal `127.0.0.0/8`, `[::1]`) so local development can serve login assets straight from the app's own dev server. The login component preserves those URLs only when it also runs on a loopback HTTP page; public pages and every other URL field remain HTTPS-only. The CLI plan, server save, editor, and component gates now enforce the same syntax and explain the carve-out when rejecting a URL.

- [#872](https://github.com/zitadel/nextgen/pull/872) [`79f5ce1`](https://github.com/zitadel/nextgen/commit/79f5ce1db6b36baab85944a667072f1936880704) Thanks [@fforootd](https://github.com/fforootd)! - Scaffolded `.zitadel/**` READMEs now show runnable `npx @zitadel/cli@<version> …` commands instead of the bare `zitadel` command, which does not exist inside a generated app. The branding dialect now explains that `layout` is the degrade preset (`centered`/`split`), not the design name — switch designs with `branding eject --design`. The branding README shows exactly where `logo_url`/`hero_url` go (and that custom fonts aren't configurable there yet), and the setup summary surfaces the `.zitadel/` customization entry points (user schema, login flow, login template) and pairs the chosen design's wizard label with its slug (e.g. "Split (reversed)" → `split-right`) so you can confirm the selection applied.

- [#889](https://github.com/zitadel/nextgen/pull/889) [`18ed11e`](https://github.com/zitadel/nextgen/commit/18ed11e03f33ef76c4bcf0f4814f9a5c7de6d640) Thanks [@fforootd](https://github.com/fforootd)! - Released Zitadel server binaries now report the published package version instead of a build timestamp, and no longer log a missing-metadata warning at startup. Source builds report the revision they were built from, and locally built Docker images identify themselves as source builds rather than claiming the published version.

- [#904](https://github.com/zitadel/nextgen/pull/904) [`aa86726`](https://github.com/zitadel/nextgen/commit/aa86726343946ea2adf10757bf47a0a9c2d71237) Thanks [@fforootd](https://github.com/fforootd)! - The console now tells an unreachable server apart from a deployment that has no
  project yet. Its boot-time configuration read (`GET /console/runtime.json`) used
  to resolve every failure — a dropped connection, a `500`, an unreadable body —
  to the same "No project yet" screen, so an outage read as missing setup and sent
  operators to run `zitadel setup` against a problem setup cannot fix. Those cases
  now render a "Server unavailable" screen naming what went wrong, with a retry
  button that re-reads the configuration in place once the server is back. A
  server that answers normally but has no project still shows the setup hint,
  unchanged.

- [#856](https://github.com/zitadel/nextgen/pull/856) [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344) Thanks [@fforootd](https://github.com/fforootd)! - The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.

- [#822](https://github.com/zitadel/nextgen/pull/822) [`41f6a0a`](https://github.com/zitadel/nextgen/commit/41f6a0a7c60e28a9adecfa9d72b964a305f7ba3d) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop `position` from `x-auth-methods` entries; `enabled` is now the only key. The
  user schema declares which authentication methods a user type supports.
  Presentation concerns such as the order methods are offered in belong to the flow
  engine, which takes them from the order of a step's actions in the flow
  definition.

  An auth-method entry now sets `additionalProperties: false`, matching the
  enclosing `x-auth-methods` object, which already rejects unknown method keys. A
  schema that still carries `position` fails validation instead of being accepted
  with the field ignored.

- [#857](https://github.com/zitadel/nextgen/pull/857) [`009fd77`](https://github.com/zitadel/nextgen/commit/009fd774f7f59bf3cf319b9753ac81b17ac7c873) Thanks [@fforootd](https://github.com/fforootd)! - Fix the two embedded UI surfaces the server hosts.

  The console at `/ui/console/` failed to load: it sent every API request to
  `/api/*`, a path the server does not serve, so the sign-in screen showed
  "POST /api/flow returned 404". It now calls the API at the server's own root,
  where it has always been. Nothing to change on your side — `/api` was only ever
  the console dev server's path.

  The hosted sign-in page at `/ui/login/` showed "flow definition: not found"
  unless you passed `?project_id=`. It now signs into the deployment's project by
  default (the first one created, or the one pinned with
  `NEXTGEN_PLATFORM_PROJECT_ID`), and shows a short setup hint when the
  deployment has no project yet. An explicit `?project_id=` still wins.

- [#858](https://github.com/zitadel/nextgen/pull/858) [`91738b9`](https://github.com/zitadel/nextgen/commit/91738b93e445fc3dd3731a04f76fb3de24436cdb) Thanks [@fforootd](https://github.com/fforootd)! - The embedded console and the test kit's `seedUser` follow the flat-by-id management contract: path-id operations (get/delete user, list passkeys, set password, get schema, get flow definition, get/update team) no longer send a `project_id` query parameter — the server resolves the scope from the resource id itself.

- [#854](https://github.com/zitadel/nextgen/pull/854) [`a0c9fbe`](https://github.com/zitadel/nextgen/commit/a0c9fbe9b6ba36e973b219236b64741441262235) Thanks [@grvijayan](https://github.com/grvijayan)! - Ignore-case list filters (contains, starts with, ends with) now lowercase both the column and the search term inside the database. Searching for a value exactly as stored always finds the row, even when the database's LOWER disagrees with Go's lowercasing (for example C-locale PostgreSQL or SQLite).

- [#829](https://github.com/zitadel/nextgen/pull/829) [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657) Thanks [@fforootd](https://github.com/fforootd)! - Preserve purpose across in-card navigation: a flow transition can declare a
  local `purpose` (`{"target": "register", "purpose": "register"}`), and taking
  it moves the flow's dispatch mode while the original purpose stays pinned.
  The default login flow (and the passkey-first preset) now ship visible
  "Sign up" / "Sign in" navigations on their entry steps built on this —
  previously the only in-card path to registration was submitting an unknown
  email. Validators (server-side and `@zitadel/config`) enforce that the purpose
  is one the definition serves, that the transition targets that purpose's entry
  step, and that `purpose` never combines with the cross-flow `action`. Navigate
  actions now also clear a pending passkey challenge, so an abandoned prompt
  cannot re-attach after navigating away.

  Existing scaffolded apps keep their local `.zitadel/flows/default-login.json`
  unchanged (local config stays authoritative). To adopt the in-card
  navigations, add the two navigate actions and their purposed transitions to
  your flow file — or re-eject the default — then `zitadel plan` / `apply`.

- [#906](https://github.com/zitadel/nextgen/pull/906) [`af41826`](https://github.com/zitadel/nextgen/commit/af4182696e569afd78be406045108dd7f9c6675e) Thanks [@fforootd](https://github.com/fforootd)! - The hosted sign-in shell at `/ui/login/` now tells a deployment it cannot reach
  apart from one that has no project yet. Its boot-time configuration read
  (`GET /console/runtime.json`) used to resolve every failure — a dropped
  connection, a `500`, an unreadable body — to the same "No project yet" screen,
  so a server whose database was down still served the sign-in page and then told
  the people trying to sign in to run `npx @zitadel/cli setup`. Those cases now
  render a "Sign-in is unavailable" screen with a retry button that re-reads the
  configuration in place, and name the underlying failure in a secondary line for
  whoever can act on it. A deployment that answers normally but has no project
  still shows the setup hint, unchanged.

- [#908](https://github.com/zitadel/nextgen/pull/908) [`3818717`](https://github.com/zitadel/nextgen/commit/3818717d9fd079828b742adf6624955e80966308) Thanks [@fforootd](https://github.com/fforootd)! - The Zitadel server container now starts as the non-root user it ships with. It previously created a data directory next to its own entrypoint before reading configuration, which is not writable by that user, so the container exited before serving — and setting a data directory via environment or config file did not avoid it. This also fixes `zitadel start --runtime docker`, which failed the same way.

- [#855](https://github.com/zitadel/nextgen/pull/855) [`be64eaa`](https://github.com/zitadel/nextgen/commit/be64eaaf3a7348d40e95874bb13c1b341cd816ed) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Local HTTP runtimes (`http://localhost`) now omit the `Secure` flag on `_zflow` and `__nextgen_session` cookies so Safari can complete register/login; HTTPS responses still set `Secure`.

- [#885](https://github.com/zitadel/nextgen/pull/885) [`f1049fd`](https://github.com/zitadel/nextgen/commit/f1049fd1b07086ffd070ecdd0b2d80958efd72f2) Thanks [@fforootd](https://github.com/fforootd)! - `zitadel setup` now pins the dev-server port in the scaffolded `dev` script for Next and Nuxt, so the app serves the port setup registered as the project's allowed origin. Previously a bare `next dev` / `nuxt dev` ignored that port and defaulted to 3000 — and Next silently moved to 3001 when 3000 was busy — so login rendered but the first submit failed with `origin "http://localhost:3000" is not allowed for this project`. The other frameworks already pinned the port in their own dev-server config (Vite's `server.port` + `strictPort`, Angular's `serve.options.port`) and are unchanged. An explicit port also turns a busy port into a loud `EADDRINUSE` instead of a silent move to a rejected origin.

  `doctor` verifies that dev script against the port recorded as the development issuer, so a script moved to another port is reported as an unapplied config edit and `doctor --fix` restores the registered port. `eject` now lists `package.json` among the edits it cannot auto-revert.

  A login that cannot start — a rejected origin being the most common cause — now reports the failure inside the login card instead of leaving a bare line of text on an otherwise empty page.

## 0.1.0-alpha.18

### Minor Changes

- [#737](https://github.com/zitadel/nextgen/pull/737) [`a964309`](https://github.com/zitadel/nextgen/commit/a9643097df1fbbf1ca339ed8b7271e4271616b0d) Thanks [@grvijayan](https://github.com/grvijayan)! - Add a team delete endpoint to the API. Deleting a team deactivates it and cascades to its memberships and lifecycle-owned users.

- [#677](https://github.com/zitadel/nextgen/pull/677) [`35d287f`](https://github.com/zitadel/nextgen/commit/35d287ff5bb092bcdee4861fd2ec268efbec6b2d) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Add authorization MVP storage: resource_scope_index, system catalog seed, assignments, membership edges, and dual-write hooks.

- [#739](https://github.com/zitadel/nextgen/pull/739) [`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Add the project claim lifecycle endpoints to the API: `POST /projects/{project_id}/claim/init`, `GET /projects/{project_id}/claim/status`, and `POST /projects/{project_id}/claim/complete`, with matching methods on the generated `@zitadel/api` client. These let a developer start a claim from the CLI, poll its status, and finish it from the browser. The status response is modelled as discriminated `pending`/`completed` variants, and the contract carries the `proj.already_claimed` (409) and `proj.claim_expired` (410) error codes plus `429` rate-limit responses on polling and completion. The server handlers arrive separately, so the operations currently respond `501 Not Implemented`.

- [#700](https://github.com/zitadel/nextgen/pull/700) [`0142d94`](https://github.com/zitadel/nextgen/commit/0142d9406d0a641858d2731fcabe2561a57edf27) Thanks [@bastionstack](https://github.com/bastionstack)! - Delete a user from the console. The users list gains a Delete action that asks you to type DELETE to confirm, then permanently removes the user along with their sessions and grants.

- [#706](https://github.com/zitadel/nextgen/pull/706) [`2fdb22e`](https://github.com/zitadel/nextgen/commit/2fdb22e76f3ca512864321a729860668d2370b70) Thanks [@bastionstack](https://github.com/bastionstack)! - The console's user detail screen now shows a user's profile as their schema defines it, split across Overview and Authentication tabs, with their registered passkeys and an action to delete the user. Profile values are read-only for now, because the API has no endpoint for updating a user.

- [#701](https://github.com/zitadel/nextgen/pull/701) [`4fdaf16`](https://github.com/zitadel/nextgen/commit/4fdaf16c6d0ea354477665049b428f34b055ef8e) Thanks [@bastionstack](https://github.com/bastionstack)! - The console's users list now takes its columns from the user schema, so it shows the attributes your schema actually defines instead of a fixed set. Users whose schema omits a column render it as empty rather than blank.

- [#762](https://github.com/zitadel/nextgen/pull/762) [`f7b2049`](https://github.com/zitadel/nextgen/commit/f7b2049eee601843e58dc96606690e6d49863fc4) Thanks [@bastionstack](https://github.com/bastionstack)! - The console now has User schema screens under Users. The list shows every schema
  in the project with the attributes it collects, its enabled sign-in methods, and
  the id and creation date that identify it. Opening one shows its fields as a
  `FIELD | TYPE | REQ.` table — nested objects drill in — beside the document
  itself as JSON or YAML with a copy button, and a second tab listing each sign-in
  method the schema declares as enabled or disabled. Schemas stay read-only in the
  console; the viewer names the CLI command that applies a change instead.

- [#637](https://github.com/zitadel/nextgen/pull/637) [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde) Thanks [@wim07101993](https://github.com/wim07101993)! - Add `DELETE /users/{user_id}` to delete a user from a project. Requires an OAuth2 bearer with the `user.write` scope and returns `204 No Content`.

- [#663](https://github.com/zitadel/nextgen/pull/663) [`de02bfc`](https://github.com/zitadel/nextgen/commit/de02bfcce196d07aedd44388895c6e8bd98a87a5) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Server assigns every resource primary key in storage dialects as a prefixed opaque string (Postgres/SQLite ULID, Spanner UUID v4); SQL no longer uses IDENTITY defaults, and create APIs do not accept client primary keys.

- [#777](https://github.com/zitadel/nextgen/pull/777) [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f) Thanks [@wim07101993](https://github.com/wim07101993)! - Add operation-specific error response schemas to the OpenAPI spec, so the
  generated client exposes typed error models per endpoint.

  Each operation's error set is inferred from the implementation rather than a
  hand-maintained doc comment, and the inference now starts at the API handler
  instead of the service it calls. That closes two gaps where an endpoint could
  return an error its schema did not list — the authorization guard's
  `not_found` / `permission_denied`, raised before any service is reached, and
  the transport's `auth.unauthorized` / `req.invalid`, raised before a handler
  runs at all. Because the generated client discriminates the error response on
  `code`, an omitted code made a real response fail to decode instead of
  surfacing as the error it is.

  `auth.unauthorized` is listed only where the operation declares a security
  requirement, so the health probes and the pre-authentication flow steps no
  longer advertise an answer they cannot give.

- [#640](https://github.com/zitadel/nextgen/pull/640) [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29) Thanks [@wim07101993](https://github.com/wim07101993)! - Add `GET /users/{user_id}/passkeys` to list a user's registered passkeys,
  returning each passkey's `id`, `name`, and `created_at`. Requires an OAuth2
  bearer with the `user.read` scope.

  Registered passkeys now get a name of their own instead of reusing the user's
  display name, which was the same for every passkey a user registered (and empty
  whenever the flow collected no identifier). A passkey takes the name the
  registering caller supplies, and otherwise one derived from the credential
  itself: `Security key`, `Synced passkey`, or `Device-bound passkey`.

- [#752](https://github.com/zitadel/nextgen/pull/752) [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13) Thanks [@wim07101993](https://github.com/wim07101993)! - New endpoint `GET /users/{user_id}/teams` serves a user's team roster, so a
  client can finally get from a user to the teams they belong to.

  Each entry is `{ id, name, membership_status, created_at, updated_at }`. The
  team's **name** travels with the entry, so a page of the roster renders without
  a follow-up `POST /teams/query` per row. Entries come back ordered by team name
  and page with `limit` / `page_token` like the other list endpoints;
  memberships the user was removed from are not returned. An unknown user is a
  404, which is a different answer from a user with an empty roster.

  The user read endpoints (`GET /users`, `GET /users/{user_id}`,
  `GET /users/me`) also gain `metadata.lifecycle_owner_team_id` — the single team
  that owns the user's identity lifecycle, or `null` when the user is self-owned.
  That is a different concept from the roster and the two need not agree
  (ADR 024): roster membership is collaboration, lifecycle ownership decides who
  may deprovision the user. The roster itself stays out of the user payload; it
  is unbounded, so it gets its own paginated resource.

- [#580](https://github.com/zitadel/nextgen/pull/580) [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2) Thanks [@fforootd](https://github.com/fforootd)! - The management API (schemas, flow definitions, users, teams, project
  queries — the operator plane of ADR 036) now enforces the access model
  settled for branding in ADR 037, closing two holes:
  - **Project binding with anti-oracle responses.** Every management
    operation requires the bearer to be bound to the requested project;
    before, any project's secret could read and write any other project's
    schemas, flow definitions, users, and teams (including setting user
    passwords). Foreign projects answer exactly like nonexistent ones, so
    project ids cannot be probed.
  - **The browser plane is locked out.** The preview secret ships to
    visitors' browsers by design (`project.read` only); it can no longer
    call any management operation — previously it could create schemas,
    manage flow definitions, list users, and set passwords. Denials are
    `403 <resource>.permission_denied`.

  Contract fixes that ride along: `createTeam` was declared `security: []`
  (callable with no credential at all) and now requires the bearer with
  `team.write`; the drifted `users.read`/`teams.read` scope names are
  normalized to `user.read`/`team.read`; the oauth2 scheme's scope
  registry now lists the team and flow-definition scopes. `project.write`
  implies the finer per-resource scopes until ADR 036's credential planes
  make them mintable.

- [#645](https://github.com/zitadel/nextgen/pull/645) [`1d32433`](https://github.com/zitadel/nextgen/commit/1d324331491e672473352f71c4e4cec59450a4cf) Thanks [@livio-a](https://github.com/livio-a)! - Align OpenAPI OAuth scopes with the permission catalog: rename plural resource scopes to singular and declare session, auth_attempt, and project-scoped configuration scopes.

  **Breaking change for clients requesting the old scope names.** `flow_definitions.read`, `flow_definitions.write`, `flow_definitions.delete`, `sessions.read`, `sessions.write`, `auth_attempts.read`, and `auth_attempts.write` are renamed to their singular forms (`flow_definition.*`, `session.*`, `auth_attempt.*`). Requests minted against the plural names must be updated.

- [#764](https://github.com/zitadel/nextgen/pull/764) [`77ceae3`](https://github.com/zitadel/nextgen/commit/77ceae3368cd5c0bb3ad691d31544b0453782b17) Thanks [@grvijayan](https://github.com/grvijayan)! - Rename the last camelCase wire fields in the OpenAPI spec to snake_case, so the whole API uses one convention.

  **Breaking:** every renamed property changes on the wire. An unknown property is dropped rather than rejected, so a client left on the old names sends and reads silently empty values instead of failing loudly — update all of them together.
  Dropped request fields fall back to their schema default, not to empty. `seed_defaults`
  defaults to `true` and `is_change_required` to `false`, so an old client gets the project
  resources it opted out of and loses the forced password change it asked for.

  Request and response properties:
  - `POST /projects` request: `previewOrigins` → `preview_origins`, `seedDefaults` → `seed_defaults`
  - `POST /projects` response: `projectSecret` → `project_secret`, `previewSecret` → `preview_secret`, `previewOrigins` → `preview_origins`, `createdAt` → `created_at`
  - `GET /projects/{project_id}` and the project query response: `previewOrigins` → `preview_origins`, `createdAt` → `created_at`, `updatedAt` → `updated_at`
  - Team responses: `createdAt` → `created_at`, `updatedAt` → `updated_at`
  - User `metadata`: `createdAt` → `created_at`, `updatedAt` → `updated_at`
  - `PUT /users/{user_id}/password` request: `isChangeRequired` → `is_change_required`
  - `GET /schemas` response items: `createdAt` → `created_at`

  Filter and sort field values (the enum value, not the property name): `POST /projects/query` and `POST /teams/query` take `created_at` instead of `createdAt` in `filter[].field` and `sorting.field`. An old `createdAt` value is now rejected as an invalid enum value.

  Stored user-schema documents are unaffected: `objectType` and `metaSchema` keep their names, since they are schema content rather than envelope fields.

- [#736](https://github.com/zitadel/nextgen/pull/736) [`d419841`](https://github.com/zitadel/nextgen/commit/d4198416f65fc5ac7182a5ccf9cb247bf07b4922) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Flag-gated platform project bootstrap: setting `platform.bootstrap_project: true` (env `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT`) makes the server idempotently ensure the built-in platform project (`proj_platform`) exists at startup and resolves it as the default. Off by default; needs no `platform.project_id`. `platform.project_id` remains the standalone pin to an existing project and, when set, must be a `proj_`-prefixed id.

- [#638](https://github.com/zitadel/nextgen/pull/638) [`de68ead`](https://github.com/zitadel/nextgen/commit/de68ead4bf02de17069185c46a71d1d7a98b1345) Thanks [@grvijayan](https://github.com/grvijayan)! - Serve the project management endpoints: `getProject` now returns the full project state, `patchProject` renames a project, and `queryProjects` lists the project the caller's secret is bound to. Invalid list requests (bad page token, unusable filter value) answer 400 instead of 500.

- [#601](https://github.com/zitadel/nextgen/pull/601) [`8197eea`](https://github.com/zitadel/nextgen/commit/8197eea30f65ac668554cb2caced367f3627bc36) Thanks [@grvijayan](https://github.com/grvijayan)! - Add a `name` column to the projects table and make project deletion cascade to all project-scoped tables via foreign keys, including team memberships.

- [#649](https://github.com/zitadel/nextgen/pull/649) [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785) Thanks [@wim07101993](https://github.com/wim07101993)! - Give every project a full key set at creation. The project key encryption key (KEK) now wraps purpose-scoped keys — token, secret and cookie encryption plus an EdDSA token signing key — and callers resolve them by purpose instead of sharing a single data-encryption key. Adds a `signing_keys` table and per-purpose "one active key per project" constraints.

- [#579](https://github.com/zitadel/nextgen/pull/579) [`734ed68`](https://github.com/zitadel/nextgen/commit/734ed68ef444c9b932f561fbda4feb371336d06d) Thanks [@grvijayan](https://github.com/grvijayan)! - Add Update, List, and Delete to the project service layer.

- [#617](https://github.com/zitadel/nextgen/pull/617) [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a) Thanks [@peintnermax](https://github.com/peintnermax)! - Add publishable-key support (ADR 036, first slice): `configureZitadel()` and the `ZitadelProject` handle accept an optional browser-safe `publishableKey`, which `getApi()` sends as the bearer on every call from that handle — enabling the browser to authenticate the handoff exchange without server-side secret injection. The server's console runtime document (`GET /console/runtime.json`) now serves the default project's publishable key (the origin-scoped preview credential, `project.read` only) alongside the project id, and the embedded console's login widget uses it.

- [#783](https://github.com/zitadel/nextgen/pull/783) [`418457f`](https://github.com/zitadel/nextgen/commit/418457f7407c712f3ff02b30df014fbf12e03d23) Thanks [@vitorbari](https://github.com/vitorbari)! - A user schema property name must be a single attribute name and cannot contain
  a dot. The rule lives in the user-schema meta-schema and its OpenAPI mirror, so
  an editor validating against the shipped dialect flags it while authoring, and
  the server rejects it on create.

  Nested properties are validated as properties: each is an object describing one
  attribute, with its annotations checked. Generated clients type a user
  property's nested `properties` map as a map of user properties.

- [#761](https://github.com/zitadel/nextgen/pull/761) [`b5b9b6e`](https://github.com/zitadel/nextgen/commit/b5b9b6eeaf3d09ccffc41812db4c339a1c1faf7b) Thanks [@vitorbari](https://github.com/vitorbari)! - The flow engine now persists a session as soon as a flow starts: an anonymous
  `building` session is created (or the client-supplied one reused), and its
  auth-attempt links to it so exchange upgrades that same session in place to
  `active` instead of creating a second one. An abandoned `building` session past
  its TTL now reports `expired`.

- [#669](https://github.com/zitadel/nextgen/pull/669) [`034b966`](https://github.com/zitadel/nextgen/commit/034b9662fe3572a525fc0c2974512ec0cd906187) Thanks [@livio-a](https://github.com/livio-a)! - Gate the operator session endpoints `GET /sessions`, `GET /sessions/{session_id}` and `DELETE /sessions/{session_id}`, which previously accepted any decryptable token and used the request's `project_id` unchecked. They now require a bearer bound to the requested project **and** an explicit `session.*` scope.

  **Breaking:** the legacy `project.write` umbrella does not reach session management, because revoking sessions logs end users out rather than administering a project. No credential mints `session.*` yet, so these three endpoints answer `sess.permission_denied` (403) until the credential planes issue app-plane scopes. Session creation, handoff exchange, and the cookie-bound `/sessions/me` pair are unaffected.

- [#757](https://github.com/zitadel/nextgen/pull/757) [`c39d501`](https://github.com/zitadel/nextgen/commit/c39d501ebb4ba36c8a6589985e9107a56fe6dce9) Thanks [@grvijayan](https://github.com/grvijayan)! - Session listing moved from `GET /sessions` to `POST /sessions/query`. Pass the project as the required `project_id` query parameter, page with `limit` and `page_token`, filter on `created_at`, `user_id`, and `state`, and sort on `created_at` or `user_id`. The operation still answers not-implemented, so this is the contract to build against rather than a working list.

- [#665](https://github.com/zitadel/nextgen/pull/665) [`d594f00`](https://github.com/zitadel/nextgen/commit/d594f00cd1b5acf8c002e9f034b3a7faca1d6555) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Use SQLite (modernc.org/sqlite, no CGO) as the zero-config local database instead of embedded Postgres. Persist at `<server.data_dir>/zitadel.db`; override with `database.sqlite:`.

- [#728](https://github.com/zitadel/nextgen/pull/728) [`09c753e`](https://github.com/zitadel/nextgen/commit/09c753eb59e0fa0cd70446a77202dc8207b1a1c1) Thanks [@IAM-marco](https://github.com/IAM-marco)! - You can now list the teams of a project with `POST /teams/query`. Pass the project as the required `project_id` query parameter, page through results with `limit` and `page_token`, and filter or sort by `createdAt`. Every team in the result carries its `status`, and deactivated teams are returned alongside active ones. The endpoint needs the same read access as `GET /teams/{team_id}`.

- [#646](https://github.com/zitadel/nextgen/pull/646) [`fd31b20`](https://github.com/zitadel/nextgen/commit/fd31b20c79de2c1d14c42aa48fab6e856e848775) Thanks [@grvijayan](https://github.com/grvijayan)! - Teams now carry a name. It is required when creating a team and is returned by the create and get team endpoints. A team name is 1 to 200 characters. Team and project names are trimmed of surrounding whitespace, and whitespace-only names are rejected. Team names must be unique within a project, ignoring case. The same name can still be used in different projects.

- [#679](https://github.com/zitadel/nextgen/pull/679) [`58696a0`](https://github.com/zitadel/nextgen/commit/58696a06cadcf118aaac866151bffed093016423) Thanks [@grvijayan](https://github.com/grvijayan)! - Teams now expose their lifecycle status. `status` is `active` or `deactivated` and is returned by the create, get and update team endpoints. A deactivated team is still readable through `GET /teams/{team_id}`, so it can be told apart from an active one. Create now returns the same team state as get and update, so its response also carries `updatedAt`.

- [#672](https://github.com/zitadel/nextgen/pull/672) [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406) Thanks [@grvijayan](https://github.com/grvijayan)! - Rename a team with `PATCH /teams/{team_id}`. The name is trimmed and must be 1 to 200 characters. It must be unique within the project ignoring case, so a taken name returns 409. Only active teams can be renamed: a deactivated or unknown team returns 404. `createTeam` now declares its 403 and 404 responses, which were missing from the contract. The team response schema is now shared between `getTeam` and `updateTeam`, renaming the generated `GetTeamResponse` type to `TeamResponse`.

- [#563](https://github.com/zitadel/nextgen/pull/563) [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80) Thanks [@fforootd](https://github.com/fforootd)! - Tenant-customizable login templates land end to end (ADR 040): eject a
  design, edit real Liquid, `plan`/`apply` publishes it, and the login
  renders it.
  - `@zitadel/server`: new Branding API (`POST /branding`,
    `GET /branding`, `GET /branding/{id}`) storing immutable per-project
    branding revisions with a lexical template gate (size, encoding,
    `<script>`/`<style>`, inline handlers, `javascript:` URLs, `| raw`).
    Flow responses now resolve the latest revision per project instead of
    the hardcoded default.
  - `@zitadel/api`: generated client and zod schemas for the Branding API.
  - `@zitadel/config`: the authoritative LiquidJS template validator
    (`@zitadel/config/template`), the `branding.json` config dialect
    meta-schema, and the ejectable design catalog (`centered`, `split`,
    `split-right`, `minimal`) with `getDefaultBrandingConfig`.
  - `@zitadel/components`: split/minimal layout chrome for the design
    catalog; the `{% mandatory_gates %}` tag name is now single-sourced
    from `@zitadel/config/template`.
  - `@zitadel/cli`: `.zitadel/branding/` becomes a synced resource — a
    `branding.json` descriptor plus a sibling `login.liquid` the CLI
    inlines on upload. `zitadel branding eject [--design <name>]`
    scaffolds it, `zitadel setup --design <name>` does so at setup and
    publishes revision 1, and `plan`/`apply` validate templates with the
    authoritative validator and publish edits as new revisions.

- [#760](https://github.com/zitadel/nextgen/pull/760) [`286cf4a`](https://github.com/zitadel/nextgen/commit/286cf4a37746c6ac7ae70864e1106f18d5895991) Thanks [@wim07101993](https://github.com/wim07101993)! - Tokens can now be revoked, and revocation is enforced when they are verified.

  Previously a token was accepted on decryption alone. Decryption proves only that
  this deployment minted the token — it says nothing about whether the grant still
  stands. Revoking a session deleted the session row but left its token record
  behind, and `GET /users/me` reads the user named in the token without checking
  that the session still exists, so a revoked session's cookie kept working until
  its own expiry passed. It no longer does.
  - **Verification resolves the token id.** For revocable token types the verifier
    looks up the token's `jti` and rejects it when the record is expired or gone.
    Only the id is stored — never the token, and never a hash of it (ADR 029).
  - **Revocation deletes the record.** A revoked token resolves to nothing, which
    is the same answer an unknown token gets — all a bearer should learn either
    way — and the tokens table keeps no rows that grant anything (ADR 037).
  - **Deleting a session revokes the tokens it issued**, in one transaction, so no
    token record outlives the session it authenticates. Rotating a session token
    likewise revokes its predecessor, so a rotated-out token stops working the
    moment its successor is issued.
  - **Project and preview secrets are revocable.** They are now issued with a
    stored `jti`, so a leaked secret can be retired instead of living forever —
    these credentials have no expiry of their own. The console's publishable key
    is the project's preview credential re-encrypted, not a new one per request,
    so revoking the preview secret retires the published key with it.

  Expired records are never honoured — verification checks `expires_at` too. There
  is no background sweeper yet, so records that expired without being revoked
  accumulate; purging them once they are past `expires_at` is safe (verification
  already rejects them) and is tracked in zitadel/nextgen#800.

  **Compatibility:** project secrets issued before this change carry no `jti`.
  They keep working — they cannot be forged without the encryption key — but
  cannot be revoked until they are reissued. Rotate any secret you need to be able
  to revoke. Session tokens already carried a `jti` and are unaffected.

- [#721](https://github.com/zitadel/nextgen/pull/721) [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8) Thanks [@wim07101993](https://github.com/wim07101993)! - Every user the API returns now carries its `id` and a read-only `metadata`
  object with `createdAt`, `updatedAt`, and `status` (`active`, `suspended`,
  `deactivated`, or `pending_purge`). `GET /users`, `GET /users/{user_id}`, and
  `GET /users/me` all serve this same typed `User` shape instead of an untyped
  object, so the generated clients describe the fields rather than handing back a
  free-form map.

  Two changes to `GET /users` need action:
  - Pagination moved from `offset` to `page_token`. Pass the `next_page_token`
    from the previous response instead of an offset; `offset` no longer exists.
    `limit` is unchanged.
  - The response is an object — `{ "users": [...], "next_page_token": "..." }` —
    rather than a bare array, and users come back newest-first instead of
    oldest-first. `next_page_token` is absent on the last page.

  `POST /users` now rejects a body that sets `id` or `metadata`; both are
  server-owned.

### Patch Changes

- [#628](https://github.com/zitadel/nextgen/pull/628) [`8dadbd8`](https://github.com/zitadel/nextgen/commit/8dadbd8cdeabc7c289c7bef8ccce3d779a43e7c4) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Add the claim_challenges table (Postgres and Spanner) for the claim lifecycle (ADR 041).

- [#740](https://github.com/zitadel/nextgen/pull/740) [`04e77a7`](https://github.com/zitadel/nextgen/commit/04e77a712edac7f9b486a6014134ddfc7cb71190) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Add claim challenge storage statements (create, get, mark completed) and the personal-team lookup across Postgres, Spanner, and SQLite, groundwork for the claim lifecycle (ADR 046).

- [#594](https://github.com/zitadel/nextgen/pull/594) [`c704fea`](https://github.com/zitadel/nextgen/commit/c704fea9f7d5f9ac037190b9979f4a897d3cd770) Thanks [@fforootd](https://github.com/fforootd)! - Load real users in the Console user list and link each entry to its detail view.

- [#794](https://github.com/zitadel/nextgen/pull/794) [`b403dc4`](https://github.com/zitadel/nextgen/commit/b403dc48830d54c96f650a0e8584a13cd4abf6f3) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Reject keyset page tokens whose sort direction no longer matches, and coerce credential resource IDs as strings so cursor paging no longer fails after the first page.

- [#778](https://github.com/zitadel/nextgen/pull/778) [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a) Thanks [@wim07101993](https://github.com/wim07101993)! - Drop the OIDC/OAuth surface from the OpenAPI contract. The spec described
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

- [#770](https://github.com/zitadel/nextgen/pull/770) [`2019602`](https://github.com/zitadel/nextgen/commit/20196023ec4ccd9cfe55c205537f85ddb487fe8f) Thanks [@grvijayan](https://github.com/grvijayan)! - A session's `state` is now one of `building`, `active`, or `expired`. The `revoked` state is gone from the session response and from the `state` filter of `POST /sessions/query`.

- [#691](https://github.com/zitadel/nextgen/pull/691) [`6652e57`](https://github.com/zitadel/nextgen/commit/6652e57b6ede15d921de029fff6aea2a7315875d) Thanks [@fforootd](https://github.com/fforootd)! - Pick the embedded Postgres port from a fixed block below the OS ephemeral range so concurrent processes' outbound connections can no longer steal it between allocation and the postmaster bind, which made `zitadel start` fail with "Local Zitadel server process exited before becoming healthy" under parallel load.

- [#404](https://github.com/zitadel/nextgen/pull/404) [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c) Thanks [@vitorbari](https://github.com/vitorbari)! - Flow engine: validate boolean and enum (select) user-schema fields at the flow step.

  The field validator now accepts a real JSON boolean for `checkbox` fields (and
  rejects a string), enforces a property's `const` (e.g. a must-accept terms
  checkbox pinned to `true`), and enforces `required` fields — both on the submit
  action and on the passkey-register issue leg. Previously these only failed later
  when `create_user` validated the user against the schema; a missing required
  field, an unticked must-accept box, or an unselected required dropdown now
  surfaces as a per-field step error instead.

- [#583](https://github.com/zitadel/nextgen/pull/583) [`63490d7`](https://github.com/zitadel/nextgen/commit/63490d715f92a1a1726b8a6c12c6afe7de52c19c) Thanks [@livio-a](https://github.com/livio-a)! - Migrate flow runtime errors to `flow.*` domain sentinels with fixed public messages (ADR 030). Wire codes change from ad-hoc strings (`flow_cookie_invalid`, `invalid_action`, …) to stable `flow.cookie_invalid`, `flow.invalid_action`, and related codes; API responses no longer echo wrapped `err.Error()` text for those paths.

- [#772](https://github.com/zitadel/nextgen/pull/772) [`f720dbb`](https://github.com/zitadel/nextgen/commit/f720dbb5b2a8ea974bad87263bd3e1e0fd377eca) Thanks [@vitorbari](https://github.com/vitorbari)! - Sessions created by the flow engine now record the request's device context (the
  `User-Agent` header and client IP), so flow-originated sessions no longer show
  blank device info. The user agent is captured at flow start and survives the
  handoff exchange; supplying an existing session leaves its user agent untouched.

- [#719](https://github.com/zitadel/nextgen/pull/719) [`b37f23b`](https://github.com/zitadel/nextgen/commit/b37f23bc68cce7ba2ed0f0c2aac081de73f1c70d) Thanks [@fforootd](https://github.com/fforootd)! - Session-state reads now bypass caches and only canonical Zitadel 401/404 error
  responses are treated as signed out, including expired or superseded session
  cookies. The browser-only `getSession` helper and its options type now live on
  the dedicated `@zitadel/sdk-next/session` entry instead of the package root.
  Framework proxies attach the project secret only to the exact
  `POST /sessions/exchange` handoff operation, so browser-reachable public and
  management paths no longer receive an infrastructure-supplied operator
  credential. After upgrading the CLI, run `zitadel doctor --fix` to migrate the
  legacy managed Vite and Angular proxy hooks. Doctor warns when an unrecognized
  proxy may still over-forward the project secret; custom proxy implementations
  remain user-owned and must be reviewed manually.

- [#799](https://github.com/zitadel/nextgen/pull/799) [`14aacb5`](https://github.com/zitadel/nextgen/commit/14aacb59c16a6a4c30ebf905e98c2d21acaa5ef2) Thanks [@livio-a](https://github.com/livio-a)! - Add structured `details.field` on flow `Fields` value decode errors and document the API `details` producer contract (ADR 030 / [#585](https://github.com/zitadel/nextgen/issues/585) task B).

- [#566](https://github.com/zitadel/nextgen/pull/566) [`def4e92`](https://github.com/zitadel/nextgen/commit/def4e92e92e54fbe8bb149c5eb9e72c0c2da1e9c) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate JSON schema storage from v1 repository helpers to v2 typed statements.

- [#584](https://github.com/zitadel/nextgen/pull/584) [`c0336d4`](https://github.com/zitadel/nextgen/commit/c0336d4dfe539f62a9bbbad35095236d2ba5c2f1) Thanks [@livio-a](https://github.com/livio-a)! - Normalize ogen decode/validation failures to the stable `req.invalid` domain message, and name the offending field on flow `Fields` value decode errors without echoing `json.Unmarshal` parser text (ADR 030).

- [#569](https://github.com/zitadel/nextgen/pull/569) [`39e5a20`](https://github.com/zitadel/nextgen/commit/39e5a20bce36555f0269febd04acf4e5c0acf9e3) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate passkey registration persistence from the v1 repository to storage v2 statements (PostgreSQL and Spanner).

- [#625](https://github.com/zitadel/nextgen/pull/625) [`a87a614`](https://github.com/zitadel/nextgen/commit/a87a614433c19ead251de28d5ebd3435aff9dcba) Thanks [@grvijayan](https://github.com/grvijayan)! - `queryProjects` now requires the `project.write` scope. Its contract still
  declared `project.read`, the browser-plane preview secret's scope, which must
  not gate an operator read — aligning it with the project management access
  model from ADR 036.

- [#554](https://github.com/zitadel/nextgen/pull/554) [`417a378`](https://github.com/zitadel/nextgen/commit/417a3786aaa1d77c041fe679ca1fcdafc8ef6ce8) Thanks [@grvijayan](https://github.com/grvijayan)! - Project creation now uses the project name from the request instead of a
  placeholder, and validates it is non-empty.

- [#724](https://github.com/zitadel/nextgen/pull/724) [`0f94093`](https://github.com/zitadel/nextgen/commit/0f94093d6f1909ce314c9c45d95703cefff6efd4) Thanks [@fforootd](https://github.com/fforootd)! - The Nuxt server middleware no longer reports an anonymous session as signed in. When the backend confirms an opaque session token but the session has not verified a user factor yet, `event.context.nextgenAuth` is now unauthenticated instead of carrying a placeholder `"unknown"` user id that no route handler could resolve. The live session's cookie is left in place so an in-progress login can still complete it — only dead credentials are cleared from the browser.

  The server also stops silently accepting invalid default flow definitions: validation errors raised while building them are now returned instead of discarded, and a metrics exporter that fails to configure now reports the error rather than starting with metrics quietly disabled.

- [#658](https://github.com/zitadel/nextgen/pull/658) [`658ce78`](https://github.com/zitadel/nextgen/commit/658ce78926b96240bcae583fee2e042283991b30) Thanks [@livio-a](https://github.com/livio-a)! - Stop `DELETE /sessions/{session_id}` from clearing the caller's `__nextgen_session` cookie. Revoking a session by id is an operator action on someone else's session, so clearing the caller's cookie would sign the operator out; in the console it would destroy the admin's own session once the session list is wired to a live backend. Cookie clearing now happens only on `DELETE /sessions/me`, which acts on the cookie's own session.

- [#649](https://github.com/zitadel/nextgen/pull/649) [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785) Thanks [@wim07101993](https://github.com/wim07101993)! - Support rotatable master keys. The master key wrapping each project's key encryption key (KEK) is configured under `server.master_keys`, and wrapped keys are re-encrypted under a replacement master key on startup, with new `domain.EncryptionKey` handling for encrypt/decrypt/rotation, storage v2 crypto-key persistence for PostgreSQL and Spanner, and dedicated error definitions (`encryption_key-*`).

- [#593](https://github.com/zitadel/nextgen/pull/593) [`6394228`](https://github.com/zitadel/nextgen/commit/6394228f61426eed4bd28d0df781a98b42a9ac95) Thanks [@fforootd](https://github.com/fforootd)! - Security: update DOMPurify in `@zitadel/components` and gRPC in `@zitadel/server`, and refresh vulnerable workspace dependencies tracked by Dependabot.

- [#582](https://github.com/zitadel/nextgen/pull/582) [`ff6fc16`](https://github.com/zitadel/nextgen/commit/ff6fc16df33a597ef68a6174f4ecd74a9cfcecca) Thanks [@fforootd](https://github.com/fforootd)! - Serialize concurrent schema migrations sharing one database: Postgres takes a session advisory lock and Spanner claims a lease row, so several server nodes (or parallel test packages) starting at once migrate exactly once instead of racing goose's DDL.

- [#768](https://github.com/zitadel/nextgen/pull/768) [`fa907c2`](https://github.com/zitadel/nextgen/commit/fa907c2272b2b4d54974b0510240f6225b7fece6) Thanks [@vitorbari](https://github.com/vitorbari)! - Session deletion is idempotent. `DELETE /sessions/{id}` and `DELETE /sessions/me`
  return `204` when the session is already gone (instead of `404`), and the
  endpoints no longer advertise the `409 already revoked` / `state: revoked`
  soft-revoke semantics — a deleted session is removed, not marked revoked.

- [#795](https://github.com/zitadel/nextgen/pull/795) [`4f4a97e`](https://github.com/zitadel/nextgen/commit/4f4a97e568268ed3c9ba30dca97b3d31a2d2edb1) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Fix sign-in intermittently failing with a session exchange conflict on Spanner. Spanner
  aborts read-write transactions when they contend, and the client retries them
  automatically, but the session exchange discarded the abort while reporting the
  conflict, so the retry never ran and the request failed instead. Read-write
  transactions also now run under a default 30 second deadline, so a contended
  transaction fails clearly rather than retrying indefinitely.

- [#573](https://github.com/zitadel/nextgen/pull/573) [`929d158`](https://github.com/zitadel/nextgen/commit/929d158371f9750410d255c631327ec042dfa9c0) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Wrap Spanner CreateAuthAttempt attempt and check inserts in one read-write transaction.

- [#641](https://github.com/zitadel/nextgen/pull/641) [`ff0a47d`](https://github.com/zitadel/nextgen/commit/ff0a47d4cc676be93d563251468e43fad03e21b0) Thanks [@grvijayan](https://github.com/grvijayan)! - Fix cursor pagination on Spanner for lists ordered by more than one column. GoogleSQL defines no ordering over structs, so the row-value comparison the cursor compiles to was rejected and the second page failed. It is now expanded into its lexicographic form.

- [#664](https://github.com/zitadel/nextgen/pull/664) [`f61eeb0`](https://github.com/zitadel/nextgen/commit/f61eeb0705d9dc3f0bfc83c1fe365e34ac945a50) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Map Spanner foreign-key (and related) integrity failures to the same typed storage errors as Postgres.

- [#815](https://github.com/zitadel/nextgen/pull/815) [`9cf915b`](https://github.com/zitadel/nextgen/commit/9cf915bb67579cdfbac4211df7634c59d38be738) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Report a contended database transaction as a retryable failure instead of an
  unexplained internal error. A read-write transaction that used up its retry
  budget under contention returned HTTP 500 with no detail and nothing in the
  logs; it now returns HTTP 503 with an `unavailable` code, and the server logs a
  warning naming the elapsed time. The retry budget itself is unchanged in
  production at 30 seconds, and is looser against the Cloud Spanner emulator,
  which serializes transactions process-wide and can starve a long one for
  reasons that do not apply to a real instance.

- [#733](https://github.com/zitadel/nextgen/pull/733) [`1b80119`](https://github.com/zitadel/nextgen/commit/1b801198ab2a5355b6f6265a38799bb126764c39) Thanks [@grvijayan](https://github.com/grvijayan)! - Enforce the 200 character team name limit in the SQLite schema, matching Postgres and Spanner.

- [#573](https://github.com/zitadel/nextgen/pull/573) [`929d158`](https://github.com/zitadel/nextgen/commit/929d158371f9750410d255c631327ec042dfa9c0) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate AuthAttemptService to AuthAttemptStatements (PostgreSQL and Spanner).

- [#570](https://github.com/zitadel/nextgen/pull/570) [`47bcb8f`](https://github.com/zitadel/nextgen/commit/47bcb8fa24473ad81bf56c9c890c7e0fd7f6b1f3) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate flow definition storage from v1 repository helpers to v2 typed statements.

- [#572](https://github.com/zitadel/nextgen/pull/572) [`ef617c8`](https://github.com/zitadel/nextgen/commit/ef617c87f0cfbb9497afb385d3d573d2fa3d4fa2) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Wrap Session CreateSession and ExchangeSession multi-write paths in withTransaction.

- [#572](https://github.com/zitadel/nextgen/pull/572) [`ef617c8`](https://github.com/zitadel/nextgen/commit/ef617c87f0cfbb9497afb385d3d573d2fa3d4fa2) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate Session repository to storage v2 SessionStatements.

- [#571](https://github.com/zitadel/nextgen/pull/571) [`01361c3`](https://github.com/zitadel/nextgen/commit/01361c31d5cda5ab0e4d881c300da7567d22eb36) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate team membership persistence from the v1 repository to typed storage v2 statements.

- [#567](https://github.com/zitadel/nextgen/pull/567) [`a40c7d1`](https://github.com/zitadel/nextgen/commit/a40c7d10f2a250ab044eb2de0967ec086c002e11) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate team storage from the v1 TeamRepository to v2 TeamStatements (postgres and spanner).

- [#567](https://github.com/zitadel/nextgen/pull/567) [`a40c7d1`](https://github.com/zitadel/nextgen/commit/a40c7d10f2a250ab044eb2de0967ec086c002e11) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Wrap multi-write team deactivate statements in a dialect transaction.

- [#568](https://github.com/zitadel/nextgen/pull/568) [`70ccb39`](https://github.com/zitadel/nextgen/commit/70ccb3921adcf2b7c58eccef894ddb0611fa59b8) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Add TokenStatements storage v2 API for PostgreSQL and Spanner.

- [#578](https://github.com/zitadel/nextgen/pull/578) [`0377731`](https://github.com/zitadel/nextgen/commit/0377731a788c42f99404fa73b5c2e5b710870da7) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate user passkey persistence from the v1 repository to storage v2 statements (PostgreSQL and Spanner) with filter-based Get/List/Update/Delete.

- [#577](https://github.com/zitadel/nextgen/pull/577) [`45ef2cc`](https://github.com/zitadel/nextgen/commit/45ef2ccd692cd592b01e8dad2bbbf95a67d9c8a0) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate user password persistence from the v1 repository to storage v2 statements (PostgreSQL and Spanner) with filter-based Get/List/Update/Delete and upsert Set.

- [#576](https://github.com/zitadel/nextgen/pull/576) [`85d9e67`](https://github.com/zitadel/nextgen/commit/85d9e6730bd749a685548e45fc3b1afe5a545dee) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Add UserRecoveryCodesStatements storage v2 API for PostgreSQL and Spanner.

- [#642](https://github.com/zitadel/nextgen/pull/642) [`4c3a3ce`](https://github.com/zitadel/nextgen/commit/4c3a3ceccfbad8bebfb3c97fcf86de5dfa7d71e4) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Reshape UserTOTPStatements to filter-based Get/List/Update/Delete (1:1 with former repository).

- [#575](https://github.com/zitadel/nextgen/pull/575) [`e313d92`](https://github.com/zitadel/nextgen/commit/e313d92ab8b289c1947273dbe1befc3551c6f8b3) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate UserTOTP storage to UserTOTPStatements for PostgreSQL and Spanner.

- [#574](https://github.com/zitadel/nextgen/pull/574) [`3f86dcd`](https://github.com/zitadel/nextgen/commit/3f86dcdee48c5ed1a50529ccca93f97809549265) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Make multi-write UserStatements (create/deactivate/delete) atomic via withTransaction.

- [#574](https://github.com/zitadel/nextgen/pull/574) [`3f86dcd`](https://github.com/zitadel/nextgen/commit/3f86dcdee48c5ed1a50529ccca93f97809549265) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Migrate User EAV storage to UserStatements (ADR 008) for PostgreSQL and Spanner.

- [#551](https://github.com/zitadel/nextgen/pull/551) [`2cf426e`](https://github.com/zitadel/nextgen/commit/2cf426e0bbe9d27059d748f16272bd1674408dc0) Thanks [@vitorbari](https://github.com/vitorbari)! - `zitadel setup` now asks "Who will sign in to your app?" and scaffolds the
  matching schema fields: `minimal` (email only), `consumer` (email, given and
  family name), or `business` (adds a `companyName` attribute). `minimal` is the
  default, so the no-flag scaffold now collects **email only** — a deliberate
  slim-down from today's output: given/family name move to `consumer`/`business`,
  and `dateOfBirth` is no longer scaffolded by any use case. The default schema
  and login-flow templates (embedded as the server-side fallback for projects
  created without the CLI) are slimmed to the same email-only baseline, so the
  no-CLI default and the `minimal` use case now agree; the per-field bodies for
  `givenName`/`familyName`/`companyName` move into the config field catalog the
  CLI composes from. This is a second axis alongside the sign-in
  preset ([#448](https://github.com/zitadel/nextgen/issues/448)): the use case owns
  the schema field set, the sign-in preset owns the flow, and the login flow's
  register step is derived from the chosen fields instead of a hard-coded list —
  so the two compose instead of multiplying into a bundle per pair. The
  question is asked before the sign-in preset; non-interactive and scripted
  runs use `--use-case` (defaults to `minimal`, never blocks); the choice is
  recorded in `zitadel.json` for guidance/status only, never behavior. `business`
  is a field set only for now — `companyName` is a plain user attribute with no
  org/team model behind it yet. Every (use case × sign-in preset) pair is
  hygiene-tested against the flow validator.
  The unused, divergent `buildUserSchema`/`fieldPreset` helpers are removed in
  favor of a single source of field defaults.

- [#287](https://github.com/zitadel/nextgen/pull/287) [`5decdd7`](https://github.com/zitadel/nextgen/commit/5decdd7cfb05beca7994ed7202548dc4915e2a59) Thanks [@adlerhurst](https://github.com/adlerhurst)! - Align user/team lifecycle storage with ADR 024: separate lifecycle ownership from team membership.

## 0.1.0-alpha.17

### Patch Changes

- [#544](https://github.com/zitadel/nextgen/pull/544) [`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999) Thanks [@fforootd](https://github.com/fforootd)! - Fixes from alpha.16 community feedback:
  - Custom schema fields now render a readable label. A property with no
    catalog entry (e.g. `department`, `dateOfBirth`) falls back to a
    humanised name ("Department", "Date of birth") on the form instead of
    leaking the raw `<step>.field.<name>` text key. A catalogued key still
    wins, so localised labels are unaffected.
  - The scaffolded `.zitadel/flows/README.md` no longer contains the
    "Presets" section twice.
  - The `warn/default-flow-swap` plan warning now leads with the impact in
    plain language: the new flow becomes the default for its purposes, and
    every page that does not explicitly set `flow-name` on
    `<zitadel-login>` will start rendering it — scope it via `audience`
    or pin `flow-name` to opt out.
  - The flip-table validation error (login/register entry step missing its
    `user_not_found`/`user_already_exists` transition) now explains who
    gets stuck where: someone without an account would be stuck at
    sign-in instead of being routed to registration, and vice versa. Plan,
    apply, and the server report the same wording.

- [#525](https://github.com/zitadel/nextgen/pull/525) [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65) Thanks [@fforootd](https://github.com/fforootd)! - Every engine-emitted step error is now a localizable `error.*` catalog
  key — no `auth_attempt.*` literals leak into the login UI anymore.
  Rejected passkey proofs emit `error.passkey_invalid` (assertion) and
  `error.passkey_registration_invalid` (attestation), translated in every
  builtin locale; rejected password submissions emit the existing
  `error.invalid_credentials`, which the login component routes inline to
  the password field. The `step.error` contract docs now describe the
  `error.*` catalog plus verbatim outcome tokens (e.g. `user_not_found`)
  instead of citing `auth_attempt.*` diagnostics.

## 0.1.0-alpha.16

### Minor Changes

- [#462](https://github.com/zitadel/nextgen/pull/462) [`99395d1`](https://github.com/zitadel/nextgen/commit/99395d1ae038643bc664033281f4c9999e675975) Thanks [@wim07101993](https://github.com/wim07101993)! - Add project list and patch endpoints to the API.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - `GET /sessions/me` now returns the signed-in user's `name` and `email` alongside `user_id`, hydrated from the conventional user-schema attributes (`name`, or `given_name` + `family_name`, and `email`). Signed-in surfaces such as `<zitadel-session>` render the human-readable identity instead of the raw user ID; both fields stay absent for anonymous sessions and schemas without those properties.

### Patch Changes

- [#522](https://github.com/zitadel/nextgen/pull/522) [`9de949d`](https://github.com/zitadel/nextgen/commit/9de949d8e9376a63da5dccc23044cdf40264123f) Thanks [@livio-a](https://github.com/livio-a)! - Align request logging with ADR 030: expected 4xx responses log at `Warn` with `error_code` (parsed from the wire envelope only), 5xx at `Error`, and raw response bodies are no longer written to logs.

- [#495](https://github.com/zitadel/nextgen/pull/495) [`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852) Thanks [@fforootd](https://github.com/fforootd)! - Fix the duplicate "Continue with passkey" button: flow responses no longer embed a stale copy of the default login template. The login widget renders the up-to-date template bundled with `@zitadel/components`, which also brings checkbox/select field rendering and the empty-subtitle guard to real flows. A tenant-provided `branding.liquid_template` still takes precedence.

- [#526](https://github.com/zitadel/nextgen/pull/526) [`62a7982`](https://github.com/zitadel/nextgen/commit/62a79824e9574eaad1f478ef3b6d51badb4d1355) Thanks [@wim07101993](https://github.com/wim07101993)! - Default password/secret hashing is now `argon2id` (RFC 9106 second recommended
  option: `time=3`, `memory=64 MiB`, `threads=4`) instead of bcrypt, per ADR 029.
  Bcrypt and legacy algorithms (scrypt, pbkdf2, sha2, md5, md5salted, phpass,
  drupal7, argon2) stay registered as verifiers, so pre-existing hashes keep
  validating and are transparently rehashed to argon2id on the next successful
  verification. Configure `password_hasher.hasher.algorithm` (and
  `password_hasher.verifiers`) to override — e.g. set `bcrypt` with `cost: 10` to
  keep the previous behavior.

- [#521](https://github.com/zitadel/nextgen/pull/521) [`e4809a3`](https://github.com/zitadel/nextgen/commit/e4809a30d21ae9ca400e58d2ccbb7078c2d3efff) Thanks [@livio-a](https://github.com/livio-a)! - Implement ADR 030 error-reporting foundation: `internal/errreport` capture toggles, `domain.Error` refinements (`Unwrap`, message-only `Error()`, structured `LogValue` with `Origin`), and instrumentation wiring for location/stack/GCP reporting.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - Flow field validation errors now travel as localisation keys instead of
  developer strings: `step.error` carries `error.<field>_<rule>` per violation
  ("; "-joined, format spelled `_invalid` to match the catalog), and the login
  components localise them — catalog-known keys render inline on their field,
  unknown fields resolve through new generic `error.field_<rule>` fallbacks
  interpolated with the step's field label (en/de/it). A key routed inline whose
  field is not on the step downgrades to a visible banner message instead of
  disappearing. Users see "Please enter a valid email" instead of
  "flow field email: format".

- [#514](https://github.com/zitadel/nextgen/pull/514) [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2) Thanks [@fforootd](https://github.com/fforootd)! - Select a flow definition by name. `<zitadel-login>` gains a `flow-name`
  attribute (`flowName` prop on every framework wrapper) that sends
  `flow_definition_name` on flow start, so a project with several synced
  flows can run a specific one instead of the audience-resolved default.
  An unknown name or a purpose mismatch surfaces as a clear startup error
  naming the attribute. Audience selection itself is now honored and
  deterministic: hinted app beats hinted team beats the newest unscoped
  flow, and a flow scoped to an app/team no longer captures the project
  default. The flows README and plan/apply docs explain how to add and
  select a second flow.

  Because newest-unscoped-wins means a new flow can silently take over the
  default login, `plan` warns on any create of an active, unscoped flow in
  a project that already has flows (`warn/default-flow-swap`, a
  non-blocking `# warning:` line and a `--json` warnings entry) — scope
  the flow via `audience` or pin `flow-name` in the widget to opt out.
  The offline dialect gains the committed `auth-methods`/`auth-method`
  meta-schema copies that `user-schema.json` references, so editors
  resolve the full dialect without network access.

- [#515](https://github.com/zitadel/nextgen/pull/515) [`aeea830`](https://github.com/zitadel/nextgen/commit/aeea83071227816e2bf2d4ee6fb4597c70908459) Thanks [@fforootd](https://github.com/fforootd)! - Disabling passkey in the user schema (`x-auth-methods.passkey.enabled: false`)
  is now enforced for flows. A flow step declaring a `passkey` or
  `passkey_register` action against a schema that does not enable passkey fails
  validation at plan time (and on the server at apply time) with
  `step "…": action "…" offers passkey but "passkey" is not an enabled
authentication method` — the same treatment the `x-auth-methods#password`
  field already gets. Previously the schema toggle applied successfully but
  /login and /register kept offering and accepting passkeys.

  Definition time is the only enforcement point, matching every other flow
  rule: a flow pins its schema revision, and repinning re-validates, so a
  validated flow's verdict cannot change at runtime. Flows applied before this
  rule keep working as applied and surface the violation on their next
  plan/apply.

- [#497](https://github.com/zitadel/nextgen/pull/497) [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87) Thanks [@fforootd](https://github.com/fforootd)! - The passkey origin-allowlist rejection now names the allowed origins (e.g. `origin "http://127.0.0.1:3000" is not allowed for this project (allowed: http://localhost:3000)`), and `<zitadel-login>` surfaces the server's error message instead of a generic "returned 400". `@zitadel/api` exports the new `apiErrorMessage` helper for extracting the server error envelope from an `ApiError`.

- [#502](https://github.com/zitadel/nextgen/pull/502) [`bdf2906`](https://github.com/zitadel/nextgen/commit/bdf29064ab783f1d14ea554f3512bf243e86d3b5) Thanks [@fforootd](https://github.com/fforootd)! - Scaffolded projects now explain their own next step. `zitadel setup` writes
  an `AGENTS.md` guidance section for AI agents and an "Authentication
  (Zitadel)" section into the app README (marker-fenced — existing content is
  never clobbered), copies the flow/schema dialect meta-schemas into
  `.zitadel/meta/`, and scaffolds flow files with
  `"$schema": "../meta/flow-definition.json"` so editors validate and
  autocomplete flow edits offline. The `$schema` pointer is local-only: sync
  ignores it and write-back preserves it. `ZitadelLogin` wrappers gain typed
  `locales`/`lang` props for labelling custom flow steps (see the new
  "Customize copy" docs page).

  `zitadel eject` removes what setup wrote: the marker-fenced guidance section
  is stripped from `README.md`/`AGENTS.md` (content outside the markers is
  untouched), and a file is deleted only when nothing but the scaffold-created
  header would remain — no stale golden path survives pointing at deleted
  `.zitadel/` files.

  Every SDK wrapper now forwards `locales`/`lang` to the widget (previously
  only React did; Solid/Qwik/Svelte accepted and discarded them, Vue/Angular
  did not expose them). The flow dialect meta-schema (`@zitadel/server`
  embeds it; `@zitadel/config` ships the committed copy) marks a transition's
  `action` as nullable, matching the OpenAPI contract — editors no longer
  flag `"action": null`.

- [#492](https://github.com/zitadel/nextgen/pull/492) [`75b61e1`](https://github.com/zitadel/nextgen/commit/75b61e1f431bdd91f6e97dce4a87d51cd9d8a152) Thanks [@fforootd](https://github.com/fforootd)! - Model the `__nextgen_session` cookie as an OpenAPI security scheme
  (`nextgenSession`) on `GET /sessions/me`, `DELETE /sessions/me`, and
  `GET /users/me` instead of a required cookie parameter. Credential absence is
  now a security failure by construction, and a cookie that fails token
  verification returns `401 auth.unauthorized` (previously `401
sess.token_invalid`), matching the missing-cookie case.

- [#516](https://github.com/zitadel/nextgen/pull/516) [`85f5044`](https://github.com/zitadel/nextgen/commit/85f504491a10f0b41b99c123e91df1f41c2d5763) Thanks [@fforootd](https://github.com/fforootd)! - Setup and status guidance now tracks where you are in the journey. The
  `zitadel setup` terminal box ends on the verify mission (install, start,
  register → sign out → sign in) plus a single breadcrumb to `zitadel status`
  and the README's Zitadel section, instead of listing customize/publish steps
  before the first login. The `--json` envelope keeps the complete
  `next_actions`/`next_commands` for agents. `zitadel status` asks the platform
  whether the project has users yet: none → verify-login guidance, some → the
  customize (.zitadel/schemas/, .zitadel/flows/) and plan/apply publish steps;
  when the server is unreachable it keeps the lifecycle-only output.
  `next_commands` is staged in lockstep: before the first proven login it
  offers `plan` and withholds `apply`.

  The server implements `GET /users` (previously generated-but-unimplemented,
  returning 500): bearer-scoped to the token's project — the exact call shape
  of the status probe — returning attribute-hydrated users with a stable
  creation-ordered `offset`/`limit` window (spec defaults limit 20, max 100).
  The staged status therefore works against a real runtime, not only the
  api-mock.

## 0.1.0-alpha.15

### Patch Changes

- [#488](https://github.com/zitadel/nextgen/pull/488) [`6e4a11a`](https://github.com/zitadel/nextgen/commit/6e4a11a7cd07587a51362d751fcc0320b00a4301) Thanks [@fforootd](https://github.com/fforootd)! - Unauthenticated requests to cookie-secured endpoints (`GET`/`DELETE /sessions/me`, `GET /users/me`) now return `401` with the stable code `auth.unauthorized` instead of `400 req.invalid`, matching the documented OpenAPI contract. API error responses no longer serialize internal diagnostics (`parent`, `location`) into `details`, and security errors return a normalized message instead of raw framework text.

## 0.1.0-alpha.14

### Minor Changes

- [#341](https://github.com/zitadel/nextgen/pull/341) [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold editable schema and flow config from shared local defaults, add project default seeding control, and seed sync state so plan is idempotent immediately after setup.

### Patch Changes

- [#456](https://github.com/zitadel/nextgen/pull/456) [`eedc8fe`](https://github.com/zitadel/nextgen/commit/eedc8fe94a850fb2c7173c0b782bcae9d30817a1) Thanks [@wim07101993](https://github.com/wim07101993)! - Add schema correlation via `objectType`: schemas now persist this field, and
  `GET /schemas` can filter by `objectType`.

- [#434](https://github.com/zitadel/nextgen/pull/434) [`ddc0c13`](https://github.com/zitadel/nextgen/commit/ddc0c1323ac7eac7332344931fe7c077857f70dc) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix passkey signup silently dropping every collected user attribute except the identifier. The passkey-register now routes user creation through `UserService`.

- [#453](https://github.com/zitadel/nextgen/pull/453) [`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b) Thanks [@vitorbari](https://github.com/vitorbari)! - Add back navigation to interactive flows. The engine injects a `back` action on rendered step responses when there's a step to return to, and clears the back stack past irreversible mutations (user creation, passkey registration) and at flow termination.

## 0.1.0-alpha.13

### Patch Changes

- [#411](https://github.com/zitadel/nextgen/pull/411) [`720e526`](https://github.com/zitadel/nextgen/commit/720e526f0f29181b1ae5824dee18cf57b10bea3f) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop the `x-password` user-property annotation. The flow engine sources the password challenge from the reserved `x-auth-methods#password` field name combined with `x-auth-methods.password.enabled` at the schema root (introduced in [#400](https://github.com/zitadel/nextgen/issues/400)); `x-password` is no longer read by any code path. Removed from the `user-property.json` meta-schema and the CLI's generated `password` preset; comments and docs updated to match.

- [#417](https://github.com/zitadel/nextgen/pull/417) [`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293) Thanks [@fforootd](https://github.com/fforootd)! - Label passkey registrations with collected identifiers and request discoverable credentials while keeping WebAuthn user handles opaque.

## 0.1.0-alpha.12

### Patch Changes

- [#336](https://github.com/zitadel/nextgen/pull/336) [`f6279a0`](https://github.com/zitadel/nextgen/commit/f6279a0bac51447533a4a33eb33479b792558783) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier outcomes (`user_not_found`, `user_already_exists`) now flip `CurrentPurpose` consistently across every dispatch path (including the passkey-issue path) and only when the routing transition is actually taken, preventing a phantom mode switch when no matching transition is wired.

- [#365](https://github.com/zitadel/nextgen/pull/365) [`9b05b82`](https://github.com/zitadel/nextgen/commit/9b05b82c3e7546ad3c4ebd4a025a991da499abf8) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier dispatch now re-runs `SubmitIdentifier` on every request and drops any in-flight ceremony when the resolved user changes. This unblocks a passkey-login failure where two users sharing a browser session could not both authenticate without a refresh — the previous user's id stayed cached in flow state and short-circuited the lookup for the next attempt.

- [#403](https://github.com/zitadel/nextgen/pull/403) [`2b2cfd5`](https://github.com/zitadel/nextgen/commit/2b2cfd58f63d564c96fdc582c07e874297a5229c) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow API: select-typed step fields now include their `validation.enum` in the response. The API mapper was dropping the resolver-derived enum, so clients rendering a `select` had no option values to display.

- [#400](https://github.com/zitadel/nextgen/pull/400) [`e5150f3`](https://github.com/zitadel/nextgen/commit/e5150f30dfc2b24230fa698bb99baeceb2841d00) Thanks [@wim07101993](https://github.com/wim07101993)! - Credentials are no longer modeled as user-schema properties — flow definitions reference them through `x-auth-methods` instead. A password field in a flow step is now `"x-auth-methods#password"`, sourced from the schema's `x-auth-methods` keyword, rather than a `password` user property carrying `x-password: true`.

- [#376](https://github.com/zitadel/nextgen/pull/376) [`5d18103`](https://github.com/zitadel/nextgen/commit/5d18103e677d31a5b9b7c93ea164bef53b3e6e96) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Fix the embedded hosted-login shell to call the Flow API on the same origin at `/flow`.

## 0.1.0-alpha.11

## 0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- [#325](https://github.com/zitadel/nextgen/pull/325) [`ae99992`](https://github.com/zitadel/nextgen/commit/ae999926df674eb7ca777e0273789b8f58f83a19) Thanks [@fforootd](https://github.com/fforootd)! - Forward normal shutdown signals from the npm server wrapper to the packaged Zitadel binary.

## 0.1.0-alpha.8

### Patch Changes

- [#319](https://github.com/zitadel/nextgen/pull/319) [`0547b8c`](https://github.com/zitadel/nextgen/commit/0547b8c397b1016e199fa16f0b208a7115720806) Thanks [@fforootd](https://github.com/fforootd)! - Cut a fresh alpha package train with the embedded UI release build fix.

## 0.1.0-alpha.7

### Patch Changes

- [#317](https://github.com/zitadel/nextgen/pull/317) [`0bacdf2`](https://github.com/zitadel/nextgen/commit/0bacdf23226a1e90c37f09b3cac245e1cf917091) Thanks [@fforootd](https://github.com/fforootd)! - Cut a fresh alpha package train after the release automation fixes.

## 0.1.0-alpha.6

### Minor Changes

- [#305](https://github.com/zitadel/nextgen/pull/305) [`2cf813e`](https://github.com/zitadel/nextgen/commit/2cf813e62d2d76346536911e3e4ccfe390fb3583) Thanks [@fforootd](https://github.com/fforootd)! - Publish the Zitadel server binary to npm through a wrapper package and platform-specific binary packages.
