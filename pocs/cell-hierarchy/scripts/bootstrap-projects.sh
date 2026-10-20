#!/usr/bin/env bash
set -euo pipefail

wait_healthy() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "$url/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "timeout waiting for $url" >&2
  exit 1
}

create_project() {
  local cell_url="$1"
  local id="$2"
  local name="$3"
  local is_parent="$4"
  local lookup="$5"
  local workspace="${6:-}"
  if curl -fsS "$cell_url/v1/projects/$id" >/dev/null 2>&1; then
    echo "skip project $id (exists on $cell_url)"
    return 0
  fi
  echo "create project $id on $cell_url (lookup=$lookup workspace=$workspace)"
  curl -fsS -X POST "$cell_url/v1/projects" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg id "$id" \
      --arg name "$name" \
      --arg ws "$workspace" \
      --argjson parent "$is_parent" \
      --argjson lookup "$lookup" \
      '{id:$id, name:$name, is_parent:$parent, lookup_enabled:$lookup, workspace_id:$ws}')" >/dev/null
}

attach_project() {
  local cell_url="$1"
  local id="$2"
  local parent_id="$3"
  local parent_cell="$4"
  local cur
  cur="$(curl -fsS "$cell_url/v1/projects/$id")"
  if printf '%s' "$cur" | jq -e '.project.parent_project_id != ""' >/dev/null 2>&1; then
    echo "skip attach $id (already attached)"
    return 0
  fi
  echo "attach $id -> $parent_id @$parent_cell"
  curl -fsS -X POST "$cell_url/v1/projects/$id/attach" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg p "$parent_id" --arg u "$parent_cell" \
      '{parent_project_id:$p, parent_cell_url:$u}')" >/dev/null
}

create_user() {
  local cell_url="$1"
  local project_id="$2"
  local email="$3"
  local users
  users="$(curl -fsS "$cell_url/v1/projects/$project_id")"
  if printf '%s' "$users" | jq -e --arg e "$email" '.users[]? | select(.email == $e)' >/dev/null 2>&1; then
    echo "skip user $email on $project_id"
    return 0
  fi
  echo "create user $email on $project_id"
  curl -fsS -X POST "$cell_url/v1/projects/$project_id/users" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg e "$email" '{email:$e, defer_float:false}')" >/dev/null
}

create_app() {
  local cell_url="$1"
  local project_id="$2"
  local name="$3"
  local apps
  apps="$(curl -fsS "$cell_url/v1/projects/$project_id/apps")"
  if printf '%s' "$apps" | jq -e --arg n "$name" '.apps[]? | select(.name == $n)' >/dev/null 2>&1; then
    echo "skip app $name on $project_id"
    return 0
  fi
  echo "create app $name on $project_id"
  curl -fsS -X POST "$cell_url/v1/projects/$project_id/apps" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg n "$name" '{name:$n}')" >/dev/null
}

PLATFORM="${PLATFORM_URL:-http://platform:8100}"
EU1="${EU1_URL:-http://eu-1:8101}"
EU2="${EU2_URL:-http://eu-2:8102}"
US1="${US1_URL:-http://us-1:8103}"
US2="${US2_URL:-http://us-2:8104}"

for u in "$PLATFORM" "$EU1" "$EU2" "$US1" "$US2"; do
  wait_healthy "$u"
done

# Sites = projects. Workspace is UX metadata (workspace_id).
# platform = lookup zone. acme-fra on eu-1; leave US empty for Expand demo.
create_project "$PLATFORM" "platform" "platform" true true ""
create_project "$EU1" "acme-fra" "acme-fra" false false "acme"

attach_project "$EU1" "acme-fra" "platform" "$PLATFORM"

create_user "$EU1" "acme-fra" "joe@example.com"
create_user "$EU1" "acme-fra" "alice@example.com"

create_app "$EU1" "acme-fra" "chat"

# Phase 5 group chain (simplified for site topology):
#   acme-fra: group:A#member@joe
#   platform: group:B#member@group:A@acme-fra
#   acme-fra: app:chat#viewer@group:B@platform
seed_tuple() {
  local cell_url="$1"
  local project_id="$2"
  local object="$3"
  local relation="$4"
  local subject_kind="$5"
  local user_key="$6"
  local home_project="$7"
  local home_cell="$8"
  local tuples
  tuples="$(curl -fsS "$cell_url/v1/projects/$project_id/tuples")"
  if printf '%s' "$tuples" | jq -e \
    --arg o "$object" --arg r "$relation" --arg k "$user_key" --arg sk "$subject_kind" \
    '.tuples[]? | select(.object == $o and .relation == $r and .user_key == $k and .subject_kind == $sk)' \
    >/dev/null 2>&1; then
    echo "skip tuple $object#$relation@$subject_kind:$user_key on $project_id"
    return 0
  fi
  echo "create tuple $object#$relation@$subject_kind:$user_key on $project_id"
  curl -fsS -X POST "$cell_url/v1/projects/$project_id/tuples" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg o "$object" --arg r "$relation" --arg sk "$subject_kind" --arg k "$user_key" \
      --arg hp "$home_project" --arg hc "$home_cell" \
      '{object:$o, relation:$r, subject_kind:$sk, user_key:$k,
        home_project_id:$hp, home_cell_url:$hc, skip_interest:true}')" >/dev/null
}

seed_tuple "$EU1" "acme-fra" "group:A" "member" "user" "joe@example.com" "acme-fra" "$EU1"
seed_tuple "$PLATFORM" "platform" "group:B" "member" "group" "A" "acme-fra" "$EU1"
seed_tuple "$EU1" "acme-fra" "app:chat" "viewer" "group" "B" "platform" "$PLATFORM"

echo "project bootstrap complete"
