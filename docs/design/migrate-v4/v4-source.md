# Reading Zitadel v4

> Reference for the [`migrate-v4` plan](README.md): what the migrator reads from
> a v4 database and how. Checked against Zitadel
> [`v4.19.5`](https://github.com/zitadel/zitadel/tree/v4.19.5). The `v4:` paths
> below are relative to that tag.

## 1. Versions and capability

The source must guarantee that no event slips past the reader.

| v4 | Position stamped | Late-commit guard | Migrator |
|---|---|---|---|
| 4.0 – 4.1 | Transaction start | `pg_stat_activity` filter on the pusher's `application_name` | Refuse; upgrade first |
| 4.2 – 4.17 | Transaction start (`NOW()`) | Advisory-lock barrier. A writer whose transaction began before the reader's but locked after it can still be missed | Only with v4 stopped |
| 4.18+ | `clock_timestamp()` at insert, after the writer's lock | Advisory-lock barrier, gap-free | Continuous sync (`--follow`) |

- **Detect capability, not version numbers.**
  - Setup steps are recorded as events: `aggregate_type = 'system'`,
    `event_type = 'system.migration.done'`, with the step in `payload->>'name'`.
  - Continuous sync needs step `77_eventstore_position_clock_timestamp`
    ([`v4:cmd/setup/77.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/cmd/setup/77.go)).
  - The barrier needs v4 ≥ 4.2. Writers take the lock in
    [`v4:internal/eventstore/v3/push.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/eventstore/v3/push.go),
    and no setup step marks that version.
- **Older data.** A database upgraded from the old `events` table may hold
  `in_tx_order` as BIGINT and a leftover `eventstore.events_old`. Read the
  column type and ignore that table.

## 2. Reading events without gaps

- **`eventstore.events2`.**
  - Columns: `instance_id`, `aggregate_type`, `aggregate_id`, `event_type`,
    `sequence`, `revision`, `created_at`, `payload` JSONB, `creator`, `owner`,
    `position` DECIMAL, `in_tx_order`.
  - The primary key `(instance_id, aggregate_type, aggregate_id, sequence)` is a
    stable event identity. `sequence` is gapless per aggregate.
  - Events are never deleted.
  - There is no index on `position` alone. Read per
    `(instance_id, aggregate_type, event_type)` on the index
    `es_projection (instance_id, aggregate_type, event_type, position)`.
- **`position` is not commit order.** A transaction that inserts early and
  commits late becomes visible "in the past".
  - v4's own projections sort by the six-column key
    `(position, in_tx_order, instance_id, aggregate_type, aggregate_id, sequence)`.
  - They resume strictly after that tuple
    ([`v4:internal/eventstore/event_sort_key.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/eventstore/event_sort_key.go)).
- **The barrier.**
  - Every v4 writer holds
    `pg_advisory_xact_lock_shared('eventstore.events2'::regclass::oid::int, hashtext(instance_id))`
    while it pushes.
  - A reader takes and releases the exclusive lock on the same key, which waits
    for all in-flight writers of that instance. It then reads only up to its own
    transaction start
    ([`v4:internal/eventstore/repository/sql/query.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/eventstore/repository/sql/query.go),
    [`postgres.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/eventstore/repository/sql/postgres.go)).

Per instance and batch, in **one READ COMMITTED transaction**:

```sql
SELECT pg_advisory_lock('eventstore.events2'::regclass::oid::integer, hashtext($1)),
       pg_advisory_unlock('eventstore.events2'::regclass::oid::integer, hashtext($1));

SELECT e.*
FROM unnest($2::text[], $3::text[]) AS scan(aggregate_type, event_type)
CROSS JOIN LATERAL (
  SELECT * FROM eventstore.events2
  WHERE instance_id = $1
    AND aggregate_type = scan.aggregate_type
    AND event_type = scan.event_type
    AND (position, in_tx_order, instance_id, aggregate_type, aggregate_id, sequence)
        > ($4, $5, $6, $7, $8, $9)
    AND position <= EXTRACT(EPOCH FROM now())
  ORDER BY position, in_tx_order, instance_id, aggregate_type, aggregate_id, sequence
  LIMIT $10
) e
ORDER BY e.position, e.in_tx_order, e.instance_id, e.aggregate_type, e.aggregate_id, e.sequence
LIMIT $10;
```

This is v4's own projection query (`prepareEventTypeScans`).

- **Same transaction.** Do not split the lock and the select into separate
  statements outside a transaction. `now()` must be no later than the lock.
- **Not REPEATABLE READ.** Its snapshot would be taken at the lock statement,
  before the writers it waited for had committed.
- **Primary only.** Advisory locks do not replicate.
- **Brief write pause.** The exclusive lock briefly holds up new writers of
  that instance. v4's projections do the same constantly.
- **Pairs with idempotent apply.** Keep the cursor beside the stage. Skip
  events at or below the stored per-aggregate `sequence`.
- **Instances.** List them from `instance.added` minus `instance.removed`, both
  on `aggregate_type = 'instance'`. A partial index (`active_instances_events`)
  covers that.

## 3. Payload conventions

- A Go `[]byte` field is base64.
- `crypto.CryptoValue` has no JSON tags. It is stored as
  `{"CryptoType":0,"Algorithm":"aes","KeyID":"idpConfigKey","Crypted":"<base64>"}`.
  JSONB keys are case-sensitive.
- A nil payload is SQL `NULL`. Accept `NULL`, `{}` and missing fields.
- `language.Tag` is a string; `und` means unset.
- Gender is an int: 0 unspecified, 1 female, 2 male, 3 diverse.
- In `*.changed` events a field may be a pointer, so absence means unchanged.
  In `user.human.profile.changed`, an empty `firstName` or `lastName` also
  means unchanged.
- **Legacy v1 names** carry the same payloads: `user.added`,
  `user.selfregistered`, `user.password.changed`, `user.email.changed`, and so
  on (`v4:internal/repository/user/v1.go`).
- **No `user.v2.*` events.** The v2 user API, v1 import and SCIM all write the
  events below.
- **Aggregate type matters.** User grants use `user.grant.*` event types on
  `aggregate_type = 'usergrant'`, so always filter on the aggregate type too.

## 4. Events the reducers consume

Each reducer keeps the newest `sequence` it applied per aggregate. Source
files are under `v4:internal/repository/`.

### Instance (`aggregate_type = 'instance'`, id = owner = instance id)

| Event | Stage effect |
|---|---|
| `instance.added`, `instance.changed` {`name`} | Name |
| `instance.removed` | Instance removed. Stop and report |
| `instance.default.org.set` {`orgId`} | Default org (the newest wins) |
| `instance.domain.added` {`domain`, `generated`}, `.primary.set`, `.removed`; `instance.trusted_domains.added`/`.removed` | Origin candidates for the report |
| `instance.policy.domain.added`/`.changed` {`userLoginMustBeDomain`, …} | Instance default for login names (default false) |
| `instance.policy.login.added`/`.changed` {`allowUsernamePassword`, `allowRegister`, `allowExternalIdp`, `forceMFA`, `disableLoginWithEmail`, `disableLoginWithPhone`, …} | `assess` flags, such as forced MFA |
| `instance.policy.login.idpprovider.added`/`.removed`/`.cascade.removed` {`idpConfigId`} | IdPs offered at sign-in |

### Organization (`aggregate_type = 'org'`, id = owner = org id)

| Event | Stage effect |
|---|---|
| `org.added`, `org.changed` {`name`} | Name |
| `org.deactivated`, `org.reactivated` | State |
| `org.removed` | Removed. **v4 writes no user events for it**: mark the org's users, IdPs and links removed |
| `org.domain.added`, `.verified`, `.primary.set`, `.removed` {`domain`} | Verified domains and the primary domain. Creating an org pushes added, verified and primary.set for its generated domain |
| `org.policy.domain.added`/`.changed`/`.removed` | Org override of `userLoginMustBeDomain` |
| `org.policy.login.*` and `org.policy.login.idpprovider.*` | Counted (org login policies are out of scope) |

### Human user (`aggregate_type = 'user'`, owner = org id)

Files: `user/human*.go`, `user/user.go`, `user/human_external_idp.go`.

| Event | Stage effect |
|---|---|
| `user.human.added`, `user.human.selfregistered` (v1: `user.added`, `user.selfregistered`) | Reset the row. Set `userName`, profile, `email`, `phone`, the password, `changeRequired`; state active |
| `user.username.changed` {`userName`} | Username. A domain-policy flip writes this for every user of the org |
| `user.domain.claimed` {`userName`} | Username becomes `<id>@temporary.<domain>` |
| `user.human.profile.changed` {`firstName`, `lastName`, `nickName`, `displayName`, `preferredLanguage`, `gender`} | Profile |
| `user.human.email.changed` {`email`} | Email, and verified reset to false |
| `user.human.email.verified` | Email verified |
| `user.human.phone.changed` {`phone`}, `.verified`, `.removed` | Phone and phone verified |
| `user.human.password.changed` {`encodedHash`, `secret`, `changeRequired`} | Password |
| `user.human.password.hash.updated` {`encodedHash`} | Password (a rehash at sign-in) |
| `user.human.initialization.code.added` / `.check.succeeded` | State initial / active |
| `user.locked`, `user.unlocked`, `user.deactivated`, `user.reactivated` | State |
| `user.removed` | Removed. The id can return later, even in another org |
| `user.human.mfa.otp.added`/`.verified`/`.removed`, `user.human.mfa.otp.sms.*`, `user.human.mfa.otp.email.*`, `user.human.mfa.u2f.token.verified`/`.removed`, `user.human.passwordless.token.verified`/`.removed`, `user.human.mfa.recoverycode.added`/`.removed` | Factor counts, which are dropped and reported |
| `user.metadata.set`/`.removed`/`.removed.all`, `user.human.avatar.added`/`.removed`, `user.human.address.changed` | Counted |

- **Password.** v4 resolves it as `crypto.SecretOrEncodedHash`. If the legacy
  `secret` is set, the hash is the bytes of `secret.Crypted`, a bcrypt string
  stored under `CryptoType` 1. Otherwise it is `encodedHash`.
- **State.** Mirror `UserV2WriteModel.Reduce`
  ([`v4:internal/command/user_v2_model.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/command/user_v2_model.go)):
  - a create event resets the user to active;
  - an init code makes the user initial, and a successful check makes them
    active again;
  - lock gives locked and unlock gives active; deactivate gives inactive and
    reactivate gives active;
  - `user.removed` gives deleted;
  - treat the owning org's removal, or the instance's, as deleted.
- **Owner.** `user.human.added` sets its owner explicitly, so a re-created id
  may sit under another org. Take the owner from the newest create event.

### Machine user

`user.machine.added`, `user.machine.changed`, `user.machine.key.added`/`.removed`,
`user.machine.secret.set`/`.removed`, `user.pat.added`/`.removed`. All of
them are only counted.

### IdP links (on the user aggregate)

| Event | Stage effect |
|---|---|
| `user.human.externalidp.added` {`idpConfigId`, `userId`, `displayName`} | A link. `userId` is the **external** subject |
| `user.human.externalidp.removed`, `.cascade.removed` {`idpConfigId`, `userId`} | Link removed |
| `user.human.externalidp.id.migrated` {`idpConfigId`, `previousId`, `newId`} | The subject changes |
| `user.human.externalidp.username.changed` | Ignored (no column in nextgen) |

For OIDC, the external id is the `sub` claim: `User.GetID` returns `Subject`
([`v4:internal/idp/providers/oidc/session.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/idp/providers/oidc/session.go)).
Other providers return other ids and need checking before they are mapped.

### IdPs (on the `instance` or `org` aggregate)

IdP ids live in the payload: `id` for templates, `idpConfigId` for legacy
configs. Both share one id space, which is also the `idpConfigId` in links.

| Event | Stage effect |
|---|---|
| `instance.idp.oidc.added`, `org.idp.oidc.added` {`id`, `name`, `issuer`, `clientId`, `clientSecret`, `scopes`, `idTokenMapping`, `usePKCE`, `isCreationAllowed`, `isLinkingAllowed`, `isAutoCreation`, `isAutoUpdate`, `autoLinkingOption`} | Generic OIDC IdP |
| `*.idp.oidc.changed` | The same fields, each optional |
| `*.idp.oidc.migrated.google`, `*.idp.oidc.migrated.azure` | The type changes. Later edits arrive as `*.idp.google.changed` / `*.idp.azure.changed` |
| `*.idp.google.added`/`.changed` {`clientId`, `clientSecret`, `scopes`, options} | Google, migrated as OIDC with `template: google` |
| `instance.idp.removed`, `org.idp.removed` {`id`} | IdP removed (also for legacy configs) |
| `iam.idp.config.added`/`.changed`/`.deactivated`/`.reactivated`/`.removed` (instance, `aggregate_type` still `instance`), `org.idp.config.*` {`idpConfigId`, `name`, `idpType`, `autoRegister`} | Legacy IdP |
| `iam.idp.oidc.config.added`/`.changed`, `org.idp.oidc.config.*` {`clientId`, `clientSecret`, `issuer`, `scopes`, …} | Legacy OIDC settings |
| `*.idp.<type>.added` for `oauth`, `jwt`, `azure`, `github`, `github_enterprise`, `gitlab`, `gitlab_self_hosted`, `ldap` / `ldap.v2`, `apple`, `saml`, `zitadel` | Counted by type. `azure`, `gitlab` and `gitlab_self_hosted` spell `client_id` / `client_secret` in snake case |

**Legacy configs.** v4's template projection reads a legacy OIDC config as:

| Field | Value |
|---|---|
| `isCreationAllowed` | true |
| `isLinkingAllowed` | true |
| `isAutoCreation` | `autoRegister` |
| `idTokenMapping` | true |
| `usePKCE` | false |

It ignores deactivate and reactivate. The migrator follows the projection,
because that is what v4's login used
([`v4:internal/query/projection/idp_template.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/query/projection/idp_template.go)).

### Login names

[`v4:internal/query/projection/login_name_query.sql`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/query/projection/login_name_query.sql)
defines login names, together with setup steps 58 and 72.

- **Effective `userLoginMustBeDomain`:** the org's domain policy if one is
  set, otherwise the instance's. The default is false.
- **True:**
  - a username is unique per org;
  - each verified org domain yields a login name `username@domain`;
  - the preferred one uses the primary domain.
- **False:** a username is unique per instance, and the login name is the
  username.
- **Email and phone are not unique in v4.** v4 also lets users sign in with a
  verified email or phone unless the login policy disables it. Nextgen has one
  identifier per schema, so expect duplicates when the identifier is `email`.

## 5. Encryption

[`v4:internal/crypto`](https://github.com/zitadel/zitadel/tree/v4.19.5/internal/crypto)

- **Master key.** 32 bytes, given as `--masterkey`, `--masterkeyFile` or the
  `ZITADEL_MASTERKEY` environment variable
  ([`v4:cmd/key/masterkey.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/cmd/key/masterkey.go)).
- **Keys.** `system.encryption_keys (id TEXT PRIMARY KEY, key TEXT)` holds
  global keys.
  - Each `key` is `base64url(IV(16) || AES-256-CFB(masterKey, rawKey))`
    ([`v4:internal/crypto/database/database.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/crypto/database/database.go),
    [`aes.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/crypto/aes.go)).
- **Values.** A `CryptoValue` with `Algorithm` `aes` is
  `std-base64(IV(16) || AES-256-CFB(key, plaintext))`.
  - Look the key up by the value's own `KeyID`, not by config.
  - There is no MAC. A wrong key returns garbage, and bad base64 returns an
    empty string without an error. Validate every result.
- **Which key encrypts what:**

  | Value | Key |
  |---|---|
  | IdP client secrets, LDAP bind passwords, Apple and SAML keys | `idpConfigKey` (`EncryptionKeys.IDPConfig`) |
  | TOTP secrets (base32) | `otpKey` |
  | SMTP | `smtpKey` |
  | SMS | `smsKey` |
  | Verification and init codes | `userKey` |

  Operators may have renamed them in their config. The `KeyID` stored in each
  value is authoritative.
- **Password hashes are not encrypted.**
  - They are passwap encodings: bcrypt `$2a$`, argon2 `$argon2id$`, scrypt,
    pbkdf2 `$pbkdf2-sha256$`, sha2-crypt `$5$` / `$6$`, md5-crypt `$1$`,
    md5salted, phpass `$P$`, drupal7 `$S$`, and plain md5 as 32 hex digits.
  - v4 hashes with bcrypt at cost 14 by default.
  - An import accepts any format whose verifier is enabled, within v4's
    `PasswordHasher.Limits` (`v4:cmd/defaults.yaml`).

## 6. What `assess` counts but does not migrate

These categories are counted as live objects by folding add and remove
events per object id. The exact type lists are in each package's
`eventstore.go`.

| Category | Aggregate, event-type prefix |
|---|---|
| Machine users, keys, PATs | `user`: `user.machine.*`, `user.pat.*` |
| Projects, apps, roles, project grants | `project`: `project.added`/`.removed`, `project.application.*`, `project.role.*`, `project.grant.*` |
| User grants (authorizations) | `usergrant`: `user.grant.*` |
| Members | `instance.member.*`, `org.member.*`, `project.member.*` |
| Actions v1 and flows | `action`: `action.*`; `org.flow.*` |
| Actions v2 | `execution`: `execution.set`, `execution.v2.set`, `execution.removed`; `target`: `target.*` |
| SMTP, SMS, email providers | `instance`: `instance.smtp.config.*`, `instance.sms.config*` |
| Branding, texts | `*.policy.label.*`, `*.customtext.*`, mail and login texts |
| Policies | `*.policy.password.complexity.*`, `.age.*`, `.lockout.*`, `.notification.*`, `.privacy.*`, the login policy's MFA and lifetimes |
| Keys | `web_key`: `web_key.*`; `key_pair` |
| Feature flags, limits, quotas, restrictions | `feature`, `limits`, `quota`, `restrictions` |
| User schemas (v4 beta) | `user_schema`: `user_schema.*`; `schemauser` |
| Runtime state, never migrated | `session`, `oidc_session`, `saml_session`, `auth_request`, `saml_request`, `device_auth`, `idpintent`, `session_logout` |

## 7. Projections, for `verify --deep`

The tables are versioned, and the names below are those of v4.19.5. Each
advances on its own; its cursor is in `projections.current_states`
(`projection_name` = table name, then `position` and `filter_offset`, which
holds `in_tx_order`). Read them in one REPEATABLE READ snapshot and compare
counts only.

| Table | What it holds |
|---|---|
| `projections.orgs1` | `org_state` 1 active, 2 inactive. Removed orgs are deleted |
| `projections.users14` | `state`: 1 active, 2 inactive, 4 locked, 6 initial. `type` 1 human, 2 machine |
| `projections.users14_humans` | Profile, email, phone, verified flags, `password_change_required`. No hash |
| `projections.login_names3` | A view, with `is_primary` |
| `projections.idp_templates6`, `projections.idp_templates6_oidc` | `owner_type` 0 instance, 1 org; `type` 1 OIDC, 10 Google. The secret is a JSONB CryptoValue |
| `projections.idp_user_links3` | PK `(instance_id, idp_id, external_user_id)`. Links are not deleted when an IdP template is removed |

## 8. Prior art in v4

- **`zitadel mirror`** ([`v4:cmd/mirror`](https://github.com/zitadel/zitadel/tree/v4.19.5/cmd/mirror))
  copies events with `COPY`. It records progress as `system.mirror.succeeded`
  events carrying the source's high-water position, and verifies by row
  counts. Reuse the high-water idea and the count checks. Its `LIMIT/OFFSET`
  paging and position re-stamping do not apply here.
- **`admin/v1/export`** ([`v4:internal/api/grpc/admin/export.go`](https://github.com/zitadel/zitadel/blob/v4.19.5/internal/api/grpc/admin/export.go))
  reads through projections. It adds password hashes and decrypted TOTP
  secrets from the eventstore, and exports only org-owned legacy IdPs. It is
  not a usable source here, but it shows which fields v4 itself considers
  transferable.
