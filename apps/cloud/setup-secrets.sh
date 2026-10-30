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
#   --force         rotate an environment that already has a key: a new key is
#                   minted, the old one moves to <environment>/replaced-<time>/
#                   and is set as the previous key, which the server decrypts
#                   with until it has re-wrapped everything (runbook, "Rotating
#                   the master key"); the root admin stays as it is
#   --new-admin     mint a new root admin as well; the server imports a document
#                   only while its user does not exist, so this is for an
#                   environment whose data starts over, not for a rotation
#
# Per environment it writes, owner-only:
#
#   master-key.pem, master-key.b64, master-key.id   RSA 4096 and the id Vercel gets
#   admin.json                                       email + password: the 1Password login item
#   admin-user.json, admin-user.b64                  the bootstrap document: a hash, never the password
#
# and replaces, for that environment alone, MASTER_KEY_PEM_B64, MASTER_KEY_ID
# and BOOTSTRAP_ADMIN_USER_JSON_B64, plus MASTER_KEY_PREVIOUS_PEM_B64 and
# MASTER_KEY_PREVIOUS_ID after a rotation (removed otherwise). With the
# 1Password CLI (`op`) on PATH and OP_VAULT set, the key becomes a document
# item and the login a login item in that vault; otherwise store
# master-key.pem and admin.json by hand.
#
# The running deployment keeps its old variables until the next one. Nothing
# here prints a secret.
set -eu
umask 077

here="$(cd "$(dirname "$0")" && pwd)"
email="admin@zitadel.com"
out="$HOME/.zitadel/cloud"
skip_vercel=
force=
new_admin=
targets=
project="${VERCEL_PROJECT_ID:-prj_Q14LQackYj9yn0zuNWrv8UT0Ggoc}"
team="${VERCEL_TEAM_SLUG:-zitadel}"

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

while [ $# -gt 0 ]; do
  case $1 in
    --email) email="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --skip-vercel) skip_vercel=1; shift ;;
    --force) force=1; shift ;;
    --new-admin) new_admin=1; shift ;;
    production|preview) targets="$targets $1"; shift ;;
    *) usage ;;
  esac
done
[ -n "$targets" ] || usage

for tool in openssl node jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "setup-secrets: $tool is required" >&2; exit 69; }
done

vc() { npx --yes vercel@64.5.0 "$@" --project "$project" --scope "$team"; }
keys='["MASTER_KEY_PEM_B64","MASTER_KEY_ID","MASTER_KEY_PREVIOUS_PEM_B64","MASTER_KEY_PREVIOUS_ID","BOOTSTRAP_ADMIN_USER_JSON_B64"]'
requested="$(printf '%s\n' $targets | jq -R . | jq -sc .)"

# Before minting anything: a variable that also serves an environment this
# run does not redo cannot be replaced for one environment alone.
envs=
if [ -z "$skip_vercel" ]; then
  envs="$(vc env ls --json)"
  shared="$(printf '%s' "$envs" | jq -r --argjson keys "$keys" --argjson req "$requested" '
    .envs[] | select(.gitBranch == null)
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

previous_production=
previous_preview=
for target in $targets; do
  dir="$out/$target"
  previous=
  if [ -e "$dir/master-key.pem" ]; then
    if [ -z "$force" ]; then
      echo "setup-secrets: $dir already holds a master key; --force rotates it" >&2
      exit 73
    fi
    previous="$dir/replaced-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$previous"
    for f in master-key.pem master-key.b64 master-key.id; do
      [ -e "$dir/$f" ] && mv "$dir/$f" "$previous/"
    done
    if [ -n "$new_admin" ]; then
      for f in admin.json admin-user.json admin-user.b64; do
        [ -e "$dir/$f" ] && mv "$dir/$f" "$previous/"
      done
    fi
    echo "$target: rotating; the previous key $(cat "$previous/master-key.id") is kept under $previous"
  fi
  eval "previous_$target=\"\$previous\""
  mkdir -p "$dir"
  chmod 700 "$out" "$dir"

  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$dir/master-key.pem" 2>/dev/null
  base64 <"$dir/master-key.pem" | tr -d '\n' >"$dir/master-key.b64"
  key_id="cloud-$target-$(date -u +%Y-%m)"
  if [ -n "$previous" ] && [ "$key_id" = "$(cat "$previous/master-key.id")" ]; then
    key_id="$key_id-$(date -u +%d%H%M)" # two rotations in a month need two ids
  fi
  printf '%s\n' "$key_id" >"$dir/master-key.id"
  echo "$target: master key $key_id at $dir/master-key.pem"

  if [ -e "$dir/admin.json" ]; then
    echo "$target: root admin unchanged ($dir/admin.json)"
  else
    node "$here/admin-document.mjs" --email "$email" --out "$dir"
    base64 <"$dir/admin-user.json" | tr -d '\n' >"$dir/admin-user.b64"
  fi

  if command -v op >/dev/null 2>&1 && [ -n "${OP_VAULT:-}" ]; then
    op document create "$dir/master-key.pem" --vault "$OP_VAULT" \
      --title "nextgen cloud $target master key $key_id" >/dev/null
    if [ -z "$previous" ] || [ -n "$new_admin" ]; then
      # The password passes on the command line; op has no stdin form for it.
      op item create --category login --vault "$OP_VAULT" \
        --title "nextgen cloud $target root admin" \
        "username=$email" "password=$(jq -r .password "$dir/admin.json")" >/dev/null
    fi
    echo "$target: stored in 1Password vault $OP_VAULT"
  else
    echo "$target: store in 1Password: $dir/master-key.pem as a document, the login in $dir/admin.json"
  fi
done

[ -n "$skip_vercel" ] && exit 0

# Upsert one variable at a time; a failed update never deletes the existing
# configuration. Values reach the CLI only over stdin, never as arguments.
add() { # name type file target
  vc env add "$1" "$4" --force --yes --type "$2" < "$3" >/dev/null
}
for target in $targets; do
  dir="$out/$target"
  eval "previous=\"\$previous_$target\""
  if [ -n "$previous" ]; then
    # Preserve the decryption key before changing the encryption key.
    add MASTER_KEY_PREVIOUS_PEM_B64 secret "$previous/master-key.b64" "$target"
    add MASTER_KEY_PREVIOUS_ID config "$previous/master-key.id" "$target"
  fi
  echo "setting master key and root admin ($target)"
  add MASTER_KEY_PEM_B64 secret "$dir/master-key.b64" "$target"
  add MASTER_KEY_ID config "$dir/master-key.id" "$target"
  add BOOTSTRAP_ADMIN_USER_JSON_B64 secret "$dir/admin-user.b64" "$target"
done

# Remove stale rotation variables only after every replacement succeeded.
# Branch overrides are not part of an environment-wide setup.
for target in $targets; do
  eval "previous=\"\$previous_$target\""
  [ -z "$previous" ] || continue
  for key in MASTER_KEY_PREVIOUS_PEM_B64 MASTER_KEY_PREVIOUS_ID; do
    if printf '%s' "$envs" | jq -e --arg key "$key" --arg target "$target" '
      any(.envs[]; .key == $key and .gitBranch == null and (.target | index($target) != null))' >/dev/null; then
      vc env rm "$key" "$target" --yes >/dev/null
    fi
  done
done

echo
echo "done. The next deployment of each environment picks the new variables up:"
for target in $targets; do
  eval "previous=\"\$previous_$target\""
  if [ -n "$previous" ]; then
    cat <<EOF
  $target: rotated. Deploy the current deployment; its first start re-wraps every project
              key. Then remove the previous key:
                vercel env rm MASTER_KEY_PREVIOUS_PEM_B64 $target --yes
                vercel env rm MASTER_KEY_PREVIOUS_ID $target --yes
EOF
  else
    cat <<EOF
  $target: new key without a previous one: right for a new or emptied database. An existing
              database needs a rotation (--force) instead, or starting over (runbook).
EOF
  fi
done
