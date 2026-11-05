# Zitadel v4 demo fixture

A Zitadel v4.19.5 instance in a local PostgreSQL, seeded through v4's own
APIs, for testing and demoing the v4 to nextgen migration.

## Regression harness

The migrator's end-to-end tests replay recorded v4 instances instead of a
live v4: [`../e2e`](../e2e) loads `../testdata/<version>/<profile>` into a fresh
database per scenario, runs the migrator and signs the users in through
nextgen's HTTP API, with their v4 passwords and through a migrated IdP. They
run in the Postgres lane (`moon run server:test-postgres`), or alone:

```sh
ZITADEL_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable \
  go -C apps/api test -count=1 -tags postgres_integration ./internal/migratev4/e2e/
```

Record the fixtures again with `./record-fixtures.sh` (same prerequisites as
below) when the pinned v4 version or `seed-v4.mjs` changes, and commit them.
The rest of this page is the manual demo against a live v4.

## Prerequisites

- PostgreSQL with superuser `postgres` (password `postgres` or trust auth),
  default `127.0.0.1:55432`.
- The `zitadel` v4.19.5 release binary.
- Node 24, `curl`, `nc`.

## Seed the full fixture

Run these commands from this directory:

```sh
export ZITADEL_BIN=/path/to/zitadel V4_DATA_DIR=/tmp/zitadel-v4demo
./start-v4.sh &   # first run creates database v4demo and the instance
v4_demo_pid=$!
until curl -fsS http://localhost:58080/debug/ready; do sleep 1; done
node seed-v4.mjs  # once per database; the summary goes to $V4_DATA_DIR/seed-summary.json
```

`kill "$v4_demo_pid"` stops v4 cleanly; the database stays. Run `./start-v4.sh` again to
reuse it.

| Variable | Default | Used by |
| --- | --- | --- |
| `ZITADEL_BIN` | required | `start-v4.sh` |
| `PGHOST`, `PGPORT` | `127.0.0.1`, `55432` | `start-v4.sh` |
| `V4_DB` | `v4demo` | `start-v4.sh` |
| `V4_PORT` | `58080` | both |
| `V4_DATA_DIR` | `${TMPDIR:-/tmp}/zitadel-v4demo` | both: `admin.pat`, `zitadel.log`, `seed-summary.json` |

This full fixture deliberately contains blockers: inactive/locked accounts,
required password changes, MFA enrollment, org login overrides and duplicate
identifiers. `assess` and `run --dry-run` report them with a nonzero exit code;
`run` must not partially import the fixture.

## Seed the supported fixture

For a passing import and sign-in check, create a separate database and data
directory. With PostgreSQL running and `ZITADEL_BIN` still set:

```sh
export V4_DB=v4demo_supported V4_DATA_DIR=/tmp/zitadel-v4demo-supported V4_PORT=58081
./start-v4.sh &
v4_demo_pid=$!
until curl -fsS http://localhost:58081/debug/ready; do sleep 1; done
node seed-v4.mjs --supported
kill "$v4_demo_pid"
wait "$v4_demo_pid"
```

This profile creates 10 active human users in 4 active orgs, without MFA or
required password changes. It uses the instance login policy and disables IdP
self-registration and automatic/manual linking; the two pre-existing Corporate
SSO links are created by the administrator. It retains the supported imported
password formats and inventory-only resources. The full fixture stays the
default. Do not weaken a real source's policies merely to pass import.

## Migrate and check sign-in

nextgen runs in the same database, in its own schema. From the repository
root, with `V4_DATA_DIR` pointing at the supported fixture:

```sh
go -C apps/api build -tags noconsole -o /tmp/nextgen-migrate-v4 .
cat > "$V4_DATA_DIR/nextgen.yaml" <<EOF
server:
  data_dir: $V4_DATA_DIR/nextgen-data
database:
  postgres: postgres://postgres@127.0.0.1:55432/v4demo_supported?sslmode=disable
EOF
printf MasterkeyNeedsToHave32Characters > "$V4_DATA_DIR/v4.key"
/tmp/nextgen-migrate-v4 -c "$V4_DATA_DIR/nextgen.yaml" migrate
/tmp/nextgen-migrate-v4 -c "$V4_DATA_DIR/nextgen.yaml" migrate-v4 assess --v4-masterkey-file "$V4_DATA_DIR/v4.key"
/tmp/nextgen-migrate-v4 -c "$V4_DATA_DIR/nextgen.yaml" migrate-v4 run --dry-run --v4-masterkey-file "$V4_DATA_DIR/v4.key"
# Both servers and all other writers must be stopped.
/tmp/nextgen-migrate-v4 -c "$V4_DATA_DIR/nextgen.yaml" migrate-v4 run --v4-stopped --target-stopped --v4-masterkey-file "$V4_DATA_DIR/v4.key"
/tmp/nextgen-migrate-v4 -c "$V4_DATA_DIR/nextgen.yaml" migrate-v4 verify --v4-stopped --target-stopped
```

Adjust the port/database if you changed the defaults. To test the full fixture's
blockers, use its own database and data directory with the same commands;
assessment, dry-run and apply must fail before creating target resources.

Run `run` again within another offline maintenance window after supported
changes in v4. `--follow` is blocked; unsupported lifecycle changes stop the
whole apply. A successful offline verify is not permission to cut traffic over.

Sign every supported fixture user in to nextgen:

```sh
MIGRATE_V4_DEMO_DSN='postgres://postgres@127.0.0.1:55432/v4demo_supported?sslmode=disable' \
MIGRATE_V4_DEMO_SUMMARY="$V4_DATA_DIR/seed-summary.json" \
go -C apps/api test -tags migratev4_demo -count=1 -v ./internal/migratev4/demo/
```

The test requires every seeded user and password to have an applied mapping;
missing imports fail rather than skip. It compares login names with v4's API
summary and reads the identifier from the imported schema. To exercise
`login_name`, initialize a fresh target database and add `--identifier login_name`
and `--source <v4 database DSN>` to every migration command; point the test's
DSN at that target. The identifier cannot change on an existing ledger.

After sign-in, rerun the offline import and verification. The importer must
report zero created/updated resources and preserve the password hashes upgraded
during sign-in. The sign-in test writes authentication attempts and password
rehashes, so run it only against this disposable demo target.

## Checked against v4.19.5

The official v4.19.5 binary and PostgreSQL 18 were exercised on 2026-11-03:

- Full fixture: assessment, dry-run and apply rejected its unsupported data;
  target projects, users and passwords remained empty.
- Supported fixture: 10 users, 4 teams, 3 IdPs, 3 secret variables and 2 links
  imported; all 10 users signed in with both identifier modes.
- Both modes passed all 10 independent verification checks. Unchanged reruns
  performed no target writes, including after password rehashes.
- Changing one user's email and password through v4's API updated that user
  on the next offline run; both modes passed sign-in and verification again.

This exercises nextgen's authentication service against real v4 data. External
OIDC exchanges and a deployed runtime cutover are not covered by this fixture.

## Seed again

`seed-v4.mjs` is not idempotent: it exits 2, writing nothing, when the org
`Acme` exists. To seed again, stop v4, then:

```sh
psql -h 127.0.0.1 -p 55432 -U postgres -c 'DROP DATABASE v4demo'
./start-v4.sh &   # overwrites admin.pat
until curl -fsS http://localhost:58080/debug/ready; do sleep 1; done
node seed-v4.mjs
```

## Facts

- Master key: `MasterkeyNeedsToHave32Characters`. It decrypts the keys in
  `system.encryption_keys`; the `idpConfigKey` one encrypts the IdP client
  secrets.
- Instance `Acme Corp v4`, domain `localhost`; org domains `<org>.localhost`.
- Console: <http://localhost:58080/ui/console>, user
  `zitadel-admin@default.localhost`, password `Password1!` (change required).
  `start-v4.sh` turns off the login v2 requirement so the bundled login works.
- Service account `admin-sa` (IAM_OWNER, org Default); its PAT is
  `$V4_DATA_DIR/admin.pat`.
- Extra password verifiers: argon2, md5plain, md5salted, pbkdf2, scrypt, sha2,
  md5, phpass. Import limits lowered to argon2 memory 4096 and pbkdf2 rounds 1
  for the passwap test vectors.
- Never log in as a user with an imported hash: v4 rehashes it to bcrypt on the
  first successful password check.

## What the seed creates

The following tables describe the default full fixture.
`$V4_DATA_DIR/seed-summary.json` records the selected profile, IDs, login names,
states and demo credentials. Keep it private and out of source control.

| Org | State | Note |
| --- | --- | --- |
| Default | active | first-instance org |
| Acme | active | custom login policy: Corporate SSO + Acme Okta |
| Globex | active | custom domain policy `userLoginMustBeDomain=true` |
| Initech | inactive | deactivated after its users were added |
| Umbrella | removed | removed after its user was added |

| User | Org | Login name | State | Password | Email | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| alice | Acme | `alice` | active | `Alice-Passw0rd!` | alice@acme.example.com | phone `+41791234567` verified; metadata `department`, `employee_id`; link Corporate SSO `sso-sub-alice`; role `customer` on Shop |
| bob | Acme | `bob` | active | `Bob-Passw0rd!` | bob@acme.example.com, unverified | link Corporate SSO `sso-sub-bob` |
| erin | Acme | `erin` | active | argon2id: `password` | erin@acme.example.com | |
| frank | Acme | `frank` | active | pbkdf2-sha256, 12 rounds: `password` | frank@acme.example.com | |
| samantha | Acme | `samantha` | active | `Samantha-Passw0rd!` | shared@example.com | same email as sam |
| lars | Acme | `lars` | locked | `Lars-Passw0rd!` | lars@acme.example.com | |
| oscar | Acme | `oscar` | active | none | oscar@acme.example.com | link Acme Okta `okta-sub-1` |
| carol | Globex | `carol@globex.localhost` | active | `Carol-Passw0rd!` | carol@globex.example.com | OTP email; link Google `google-sub-carol` |
| alice | Globex | `alice@globex.localhost` | active | `AliceG-Passw0rd!` | alice@globex.example.com | same username as alice in Acme |
| grace | Globex | `grace@globex.localhost` | active | md5plain: `password` | grace@globex.example.com | |
| niaj | Globex | `niaj@globex.localhost` | active | md5-crypt `$1$`: `password` | niaj@globex.example.com | |
| dana | Globex | `dana@globex.localhost` | inactive | `Dana-Passw0rd!` | dana@globex.example.com | |
| zitadel-admin@default.localhost | Default | same | active | `Password1!` | zitadel-admin@default.localhost | change required |
| dave | Default | `dave` | active | `Dave-Passw0rd!` | dave@example.com | link GitHub `12345` |
| heidi | Default | `heidi` | active | sha512-crypt `$6$`: `Hello world!` | heidi@example.com | |
| mallory | Default | `mallory` | active | phpass `$P$`: `test12345` | mallory@example.com | |
| olivia | Default | `olivia` | active | md5salted-suffix: `Test1000!` | olivia@example.com | |
| peggy | Default | `peggy` | active | bcrypt `$2y$`: `password` | peggy@example.com | |
| sam | Default | `sam` | active | `Sam-Passw0rd!` | Shared@Example.com | change required |
| ian | Default | `ian` | initial | none | ian@example.com, unverified | created with the v1 API |
| rita | Default | `rita` | removed | `Rita-Passw0rd!` | rita@example.com | |
| ivan | Initech | `ivan` | active | scrypt: `password` | ivan@initech.example.com | org inactive |
| judy | Initech | `judy` | active | `Judy-Passw0rd!` | judy@initech.example.com | org inactive |
| albert | Umbrella | `albert` | removed with org | `Albert-Passw0rd!` | albert@umbrella.example.com | no `user.removed` event |

Emails are verified unless marked. Plaintext passwords are stored as bcrypt
cost 14; imported hashes are stored as given.

| IdP | Type | Owner | Client ID / secret | Login policies |
| --- | --- | --- | --- | --- |
| Corporate SSO | generic OIDC, issuer `https://sso.example.com`, PKCE, no ID token mapping | instance | `corp-client` / `corp-secret-123` | instance, Acme |
| Acme Okta | generic OIDC, issuer `https://acme.okta.example.com`, ID token mapping | org Acme | `acme-client` / `acme-secret-456` | Acme |
| Google | Google | instance | `google-client` / `google-secret-789` | none |
| GitHub | GitHub | instance | `github-client` / `github-secret-000` | none |

Inventory: machine user `ci-bot` (Acme) with a PAT; project `Shop` (Acme) with
role `customer` and OIDC app `Shop Web`; action target `audit-webhook`
(needs DNS for `example.com`, skipped otherwise).
