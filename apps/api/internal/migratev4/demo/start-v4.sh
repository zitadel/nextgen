#!/usr/bin/env bash
# Starts a Zitadel v4 instance with `zitadel start-from-init` against a local
# Postgres, for the v4 -> nextgen migration demo. Runs in the foreground (the
# caller backgrounds it); SIGTERM/SIGINT stops it cleanly.
#
# The first run creates the database, the instance "Acme Corp v4" and the PAT
# file. Later runs reuse the database: setup skips the first-instance step, so
# the PAT is written only once.
set -euo pipefail

: "${ZITADEL_BIN:?set ZITADEL_BIN to the zitadel v4.19.5 binary}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55432}"
V4_DB="${V4_DB:-v4demo}"
V4_PORT="${V4_PORT:-58080}"
V4_DATA_DIR="${V4_DATA_DIR:-${TMPDIR:-/tmp}/zitadel-v4demo}"
# Fixed demo master key: it encrypts the keys in system.encryption_keys, which
# encrypt the IdP client secrets. Never use it outside a demo.
V4_MASTERKEY="MasterkeyNeedsToHave32Characters"

if [[ ! -x "$ZITADEL_BIN" ]]; then
  echo "ZITADEL_BIN is not executable: $ZITADEL_BIN" >&2
  exit 1
fi
if nc -z 127.0.0.1 "$V4_PORT" 2>/dev/null; then
  echo "port $V4_PORT is already in use" >&2
  exit 1
fi
mkdir -p "$V4_DATA_DIR"
V4_DATA_DIR="$(cd "$V4_DATA_DIR" && pwd)"
V4_LOG="$V4_DATA_DIR/zitadel.log"

# Network: plain HTTP on localhost.
export ZITADEL_PORT="$V4_PORT"
export ZITADEL_EXTERNALPORT="$V4_PORT"
export ZITADEL_EXTERNALDOMAIN="localhost"
export ZITADEL_EXTERNALSECURE="false"

# Database: `init` creates the database and the `zitadel` role as `postgres`.
export ZITADEL_DATABASE_POSTGRES_HOST="$PGHOST"
export ZITADEL_DATABASE_POSTGRES_PORT="$PGPORT"
export ZITADEL_DATABASE_POSTGRES_DATABASE="$V4_DB"
export ZITADEL_DATABASE_POSTGRES_USER_USERNAME="zitadel"
export ZITADEL_DATABASE_POSTGRES_USER_PASSWORD="zitadel"
export ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE="disable"
export ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME="postgres"
export ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD="postgres"
export ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE="disable"

# First instance: default org "Default" with the default human admin
# (zitadel-admin, Password1!) and an IAM_OWNER service account whose PAT
# seed-v4.mjs uses.
export ZITADEL_FIRSTINSTANCE_INSTANCENAME="Acme Corp v4"
export ZITADEL_FIRSTINSTANCE_ORG_NAME="Default"
export ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_USERNAME="admin-sa"
export ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_NAME="Admin Service Account"
export ZITADEL_FIRSTINSTANCE_ORG_MACHINE_PAT_EXPIRATIONDATE="2099-01-01T00:00:00Z"
export ZITADEL_FIRSTINSTANCE_PATPATH="$V4_DATA_DIR/admin.pat"
# Use the login v1 bundled in the binary, so the v4 console works without a
# separately hosted login v2.
export ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED="false"

# Accept imported password hashes in legacy formats. The passwap test vectors
# seed-v4.mjs imports use argon2 m=4096 and pbkdf2 with 12 rounds, below the
# default import limits.
export ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_VERIFIERS="argon2,md5plain,md5salted,pbkdf2,scrypt,sha2,md5,phpass"
export ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_LIMITS_ARGON2_MINMEMORY="4096"
export ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_LIMITS_PBKDF2_MINROUNDS="1"

echo "zitadel v4:  http://localhost:$V4_PORT (database $V4_DB on $PGHOST:$PGPORT)"
echo "logs:        $V4_LOG"
echo "admin PAT:   $V4_DATA_DIR/admin.pat (written on the first run only)"
echo "ready check: curl -fsS http://localhost:$V4_PORT/debug/ready"

exec "$ZITADEL_BIN" start-from-init \
  --masterkey "$V4_MASTERKEY" \
  --tlsMode disabled \
  >>"$V4_LOG" 2>&1
