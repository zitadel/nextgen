#!/bin/sh
# Render the server config from the environment, then exec the server.
#
# `server.master_keys` can only be loaded from a YAML file (the server ignores
# the NEXTGEN_SERVER_MASTER_KEYS_* env form), and a Vercel container only
# receives environment variables. So this script turns MASTER_KEY_PEM_B64 and
# MASTER_KEY_ID into <data_dir>/nextgen.yaml and starts the server with
# --config pointing at it. Every other setting stays a NEXTGEN_* env var.
#
# Inputs
#   MASTER_KEY_PEM_B64        required, base64 of the RSA private key PEM
#   MASTER_KEY_ID             optional, key id under server.master_keys
#                             (default "preview"); rotation adds a new id
#   PORT                      optional, Vercel's routing port (default 8080)
#   NEXTGEN_SERVER_DATA_DIR   optional, where the config is written
#                             (default /tmp/nextgen-data)
#   BOOTSTRAP_ADMIN_USER_JSON_B64
#                             optional, base64 of the platform admin's
#                             bootstrap user document (scripts/admin-user.ts)
#   NEXTGEN_BIN               test seam, the server binary to exec
set -eu

# Migrations belong to the deploy pipeline (nextgen migrate from the same
# image, before the deploy), never to a serving container: a preview or a
# manual deploy must not be able to change a schema by starting. Refuse the
# server's --migrate flag no matter how it arrives (CMD, args, Vercel config).
for arg in "$@"; do
  case "$arg" in
    --migrate | --migrate=*)
      echo "preview-entrypoint: refusing --migrate; migrations run in cloud-deploy.yml, not in the container" >&2
      exit 64
      ;;
  esac
done

: "${MASTER_KEY_PEM_B64:?MASTER_KEY_PEM_B64 must be set (base64 of the master key PEM)}"
key_id="${MASTER_KEY_ID:-preview}"
case "$key_id" in
  "" | *[!A-Za-z0-9._-]*)
    echo "preview-entrypoint: MASTER_KEY_ID must match [A-Za-z0-9._-]+, got '$key_id'" >&2
    exit 64
    ;;
esac

data_dir="${NEXTGEN_SERVER_DATA_DIR:-/tmp/nextgen-data}"
export NEXTGEN_SERVER_DATA_DIR="$data_dir"
# Never write under <data_dir>/master-keys/: anything there is adopted as a key.
mkdir -p "$data_dir"
config="$data_dir/nextgen.yaml"

umask 077
{
  printf 'server:\n'
  printf '  generate_master_key: false\n'
  printf '  master_keys:\n'
  printf '    %s:\n' "$key_id"
  printf '      use_for_encryption: true\n'
  printf '      private_key: |\n'
  # Block scalar: strip CRs, blank lines and stray indentation from the
  # pasted key, then indent every line uniformly under `private_key: |`.
  printf '%s' "$MASTER_KEY_PEM_B64" | base64 -d | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e '/^$/d' -e 's/^/        /'
  printf '\n'
} > "$config"
unset MASTER_KEY_PEM_B64

if ! grep -q -- '^        -----BEGIN ' "$config" || ! grep -q -- '^        -----END ' "$config"; then
  echo "preview-entrypoint: MASTER_KEY_PEM_B64 does not decode to a PEM block" >&2
  exit 64
fi

# Optional seeded platform admin (scripts/admin-user.ts): rendered next to the
# config and handed to the server as --user-file. The import is idempotent,
# so the document can stay set across deploys. The file carries a password
# hash, never the password.
if [ -n "${BOOTSTRAP_ADMIN_USER_JSON_B64:-}" ]; then
  admin_file="$data_dir/admin-user.json"
  printf '%s' "$BOOTSTRAP_ADMIN_USER_JSON_B64" | base64 -d > "$admin_file"
  unset BOOTSTRAP_ADMIN_USER_JSON_B64
  if ! grep -q '"header"' "$admin_file" || ! grep -q '"authenticators"' "$admin_file"; then
    echo "preview-entrypoint: BOOTSTRAP_ADMIN_USER_JSON_B64 does not decode to a bootstrap user document" >&2
    exit 64
  fi
  set -- --user-file "$admin_file" "$@"
fi

# Vercel routes to $PORT; the base image runs as uid 65532, so stay unprivileged.
export NEXTGEN_SERVER_ADDRESS=":${PORT:-8080}"

exec "${NEXTGEN_BIN:-/usr/local/bin/nextgen}" server --config "$config" "$@"
