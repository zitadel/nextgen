#!/bin/sh
# Mints the secrets of the hosted cloud's Vercel environments and sets them on
# the project: a master key of its own and a root admin of its own per
# environment, both kept in the team password manager (1Password).
#
#   sh apps/cloud/setup-secrets.sh [options] production preview
#
#   --email ADDR    the root admin's sign-in email (default admin@zitadel.com)
#   --out DIR       where the files land (default ~/.zitadel/cloud/<environment>/)
#   --skip-vercel   mint the files, set nothing on Vercel
#   --force         replace an environment's existing files; they move to
#                   <environment>/replaced-<time>/ rather than being deleted
#
# Per environment it writes, owner-only:
#
#   master-key.pem, master-key.b64, master-key.id   RSA 4096 and the id Vercel gets
#   admin.json                                       email + password: the 1Password login item
#   admin-user.json, admin-user.b64                  the bootstrap document: a hash, never the password
#
# and replaces MASTER_KEY_PEM_B64, MASTER_KEY_ID and BOOTSTRAP_ADMIN_USER_JSON_B64
# for that environment alone. With the 1Password CLI (`op`) on PATH and OP_VAULT
# set, the key becomes a document item and the login a login item in that vault;
# otherwise store master-key.pem and admin.json by hand.
#
# A new master key cannot unwrap what the old one wrapped. Production needs
# its schema dropped and a deployment afterwards; preview databases are dropped
# and the next build recreates them (runbook, "Replacing the secrets"). The
# running deployment keeps its old variables until the next one.
#
# Nothing here prints a secret.
set -eu
umask 077

here="$(cd "$(dirname "$0")" && pwd)"
email="admin@zitadel.com"
out="$HOME/.zitadel/cloud"
skip_vercel=
force=
targets=
project="${VERCEL_PROJECT_ID:-prj_Q14LQackYj9yn0zuNWrv8UT0Ggoc}"
team="${VERCEL_TEAM_SLUG:-zitadel}"

usage() {
  sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

while [ $# -gt 0 ]; do
  case $1 in
    --email) email="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --skip-vercel) skip_vercel=1; shift ;;
    --force) force=1; shift ;;
    production|preview) targets="$targets $1"; shift ;;
    *) usage ;;
  esac
done
[ -n "$targets" ] || usage

for tool in openssl node jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "setup-secrets: $tool is required" >&2; exit 69; }
done

vc() { npx --yes vercel@63.1.2 "$@"; }
keys='["MASTER_KEY_PEM_B64","MASTER_KEY_ID","BOOTSTRAP_ADMIN_USER_JSON_B64"]'
requested="$(printf '%s\n' $targets | jq -R . | jq -sc .)"

# Before minting anything: a variable that also serves an environment this
# run does not redo cannot be replaced for one environment alone.
envs=
if [ -z "$skip_vercel" ]; then
  envs="$(vc api "/v9/projects/$project/env?slug=$team")"
  shared="$(printf '%s' "$envs" | jq -r --argjson keys "$keys" --argjson req "$requested" '
    .envs[]
    | select((.key as $k | $keys | index($k) != null)
        and ((.target - (.target - $req)) | length > 0)
        and ((.target - $req) | length > 0))
    | "  \(.key) (\(.target | join(", ")))"')"
  if [ -n "$shared" ]; then
    echo "setup-secrets: these variables also serve an environment this run does not redo;" >&2
    echo "run with that environment as well, or split them in the Vercel dashboard first:" >&2
    echo "$shared" >&2
    exit 65
  fi
fi

for target in $targets; do
  dir="$out/$target"
  if [ -e "$dir/master-key.pem" ]; then
    if [ -z "$force" ]; then
      echo "setup-secrets: $dir already holds a master key; --force replaces it (the old files are kept under replaced-*)" >&2
      exit 73
    fi
    replaced="$dir/replaced-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$replaced"
    for f in master-key.pem master-key.b64 master-key.id admin.json admin-user.json admin-user.b64; do
      [ -e "$dir/$f" ] && mv "$dir/$f" "$replaced/"
    done
    echo "$target: previous files moved to $replaced"
  fi
  mkdir -p "$dir"
  chmod 700 "$out" "$dir"

  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$dir/master-key.pem" 2>/dev/null
  base64 <"$dir/master-key.pem" | tr -d '\n' >"$dir/master-key.b64"
  key_id="cloud-$target-$(date -u +%Y-%m)"
  printf '%s\n' "$key_id" >"$dir/master-key.id"
  echo "$target: master key $key_id at $dir/master-key.pem"

  node "$here/admin-document.mjs" --email "$email" --out "$dir"
  base64 <"$dir/admin-user.json" | tr -d '\n' >"$dir/admin-user.b64"

  if command -v op >/dev/null 2>&1 && [ -n "${OP_VAULT:-}" ]; then
    op document create "$dir/master-key.pem" --vault "$OP_VAULT" \
      --title "nextgen cloud $target master key $key_id" >/dev/null
    # The password passes on the command line; op has no stdin form for it.
    op item create --category login --vault "$OP_VAULT" \
      --title "nextgen cloud $target root admin" \
      "username=$email" "password=$(jq -r .password "$dir/admin.json")" >/dev/null
    echo "$target: key and root admin stored in 1Password vault $OP_VAULT"
  else
    echo "$target: store in 1Password: $dir/master-key.pem as a document, the login in $dir/admin.json"
  fi
done

[ -n "$skip_vercel" ] && exit 0

printf '%s' "$envs" | jq -r --argjson keys "$keys" --argjson req "$requested" '
  .envs[]
  | select((.key as $k | $keys | index($k) != null) and ((.target - (.target - $req)) | length > 0))
  | "\(.id) \(.key) \(.target | join(","))"' |
while read -r id key env_targets; do
  echo "deleting $key ($env_targets)"
  vc api "/v9/projects/$project/env/$id?slug=$team" -X DELETE --dangerously-skip-permissions --raw >/dev/null
done

add() { # name type file target
  jq -n --arg key "$1" --arg type "$2" --rawfile value "$3" --arg t "$4" \
    '{key: $key, value: ($value | rtrimstr("\n")), type: $type, target: [$t]}' |
    vc api "/v10/projects/$project/env?slug=$team" -X POST --input - --raw >/dev/null
}
for target in $targets; do
  dir="$out/$target"
  echo "adding MASTER_KEY_PEM_B64, MASTER_KEY_ID=$(cat "$dir/master-key.id"), BOOTSTRAP_ADMIN_USER_JSON_B64 ($target)"
  add MASTER_KEY_PEM_B64 sensitive "$dir/master-key.b64" "$target"
  add MASTER_KEY_ID encrypted "$dir/master-key.id" "$target"
  add BOOTSTRAP_ADMIN_USER_JSON_B64 sensitive "$dir/admin-user.b64" "$target"
done

cat <<EOF

done. The next deployment of each environment picks the new variables up. Before it:
EOF
for target in $targets; do
  case $target in
    production) cat <<'EOF'
  production: the data is wrapped with the old key. On the production database (PlanetScale
              console or psql, as the migrations' role):
                DROP SCHEMA zitadel_nextgen CASCADE;
              then deploy (push, or redeploy the current deployment). The build migrates the
              empty schema and the first start imports the root admin.
EOF
    ;;
    preview) cat <<'EOF'
  preview:    drop the existing preview databases on the preview cluster; the next build of a
              branch recreates and migrates its own:
                SELECT datname FROM pg_database WHERE datname LIKE 'preview\_%';
                DROP DATABASE "preview_…" WITH (FORCE);
EOF
    ;;
  esac
done
