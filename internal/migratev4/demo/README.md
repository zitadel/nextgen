# Zitadel v4 demo fixture

A Zitadel v4.19.5 instance in a local PostgreSQL, seeded through v4's own
APIs, for testing and demoing the v4 to nextgen migration.

## Prerequisites

- PostgreSQL with superuser `postgres` (password `postgres` or trust auth),
  default `127.0.0.1:55432`.
- The `zitadel` v4.19.5 release binary.
- Node 24, `curl`, `nc`.

## Run

```sh
export ZITADEL_BIN=/path/to/zitadel V4_DATA_DIR=/tmp/zitadel-v4demo
./start-v4.sh &   # first run creates database v4demo and the instance
until curl -fsS http://localhost:58080/debug/ready; do sleep 1; done
node seed-v4.mjs  # once per database; the summary goes to $V4_DATA_DIR/seed-summary.json
```

`kill %1` stops v4 cleanly; the database stays. Run `./start-v4.sh` again to
reuse it.

| Variable | Default | Used by |
| --- | --- | --- |
| `ZITADEL_BIN` | required | `start-v4.sh` |
| `PGHOST`, `PGPORT` | `127.0.0.1`, `55432` | `start-v4.sh` |
| `V4_DB` | `v4demo` | `start-v4.sh` |
| `V4_PORT` | `58080` | both |
| `V4_DATA_DIR` | `${TMPDIR:-/tmp}/zitadel-v4demo` | both: `admin.pat`, `zitadel.log`, `seed-summary.json` |

## Migrate it

nextgen runs in the same database, in its own schema. From the repository
root:

```sh
go build -o nextgen .
cat > nextgen.yaml <<'EOF'
server:
  data_dir: ./nextgen-data
database:
  postgres: postgres://postgres@127.0.0.1:55432/v4demo?sslmode=disable
EOF
printf MasterkeyNeedsToHave32Characters > v4.key
./nextgen -c nextgen.yaml migrate-v4 assess --v4-masterkey-file v4.key
./nextgen -c nextgen.yaml migrate-v4 run --v4-masterkey-file v4.key
./nextgen -c nextgen.yaml migrate-v4 verify
```

Run `run` again after changing something in v4 (console or API, v4 may keep
running): it converges nextgen and changes nothing else.

Sign every seeded user with a known password in to nextgen, and see why the
others cannot:

```sh
MIGRATE_V4_DEMO_DSN='postgres://postgres@127.0.0.1:55432/v4demo?sslmode=disable' \
MIGRATE_V4_DEMO_SUMMARY="$V4_DATA_DIR/seed-summary.json" \
go test -tags migratev4_demo -count=1 -v ./internal/migratev4/demo/
```

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

`$V4_DATA_DIR/seed-summary.json` holds the IDs, login names and states.

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
