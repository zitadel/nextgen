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
  if curl -fsS "$cell_url/v1/projects/$id" >/dev/null 2>&1; then
    echo "skip project $id (exists on $cell_url)"
    return 0
  fi
  echo "create project $id on $cell_url (lookup=$lookup)"
  curl -fsS -X POST "$cell_url/v1/projects" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg id "$id" \
      --arg name "$name" \
      --argjson parent "$is_parent" \
      --argjson lookup "$lookup" \
      '{id:$id, name:$name, is_parent:$parent, lookup_enabled:$lookup}')" >/dev/null
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
EU="${EU_URL:-http://eu:8101}"
EU1="${EU1_URL:-http://eu-1:8102}"
EU2="${EU2_URL:-http://eu-2:8103}"
US="${US_URL:-http://us:8104}"
AUS="${AUS_URL:-http://aus:8105}"

for u in "$PLATFORM" "$EU" "$EU1" "$EU2" "$US" "$AUS"; do
  wait_healthy "$u"
done

# Seed projects: id hosted on cell, lookup flag
create_project "$PLATFORM" "platform" "platform" true true
create_project "$EU" "eu" "eu" true true
create_project "$EU1" "team-eu-1" "team-eu-1" false false
create_project "$EU2" "team-eu-2" "team-eu-2" false false
create_project "$US" "us" "us" false false
create_project "$AUS" "aus" "aus" false false

attach_project "$EU" "eu" "platform" "$PLATFORM"
attach_project "$EU1" "team-eu-1" "eu" "$EU"
attach_project "$EU2" "team-eu-2" "eu" "$EU"
attach_project "$US" "us" "platform" "$PLATFORM"
attach_project "$AUS" "aus" "platform" "$PLATFORM"

create_user "$EU1" "team-eu-1" "alice@example.com"
create_user "$EU2" "team-eu-2" "bob@example.com"
create_user "$EU2" "team-eu-2" "joe@example.com"

# Phase 3: regional app on us (grant left to scenario button)
create_app "$US" "us" "chat"

echo "project bootstrap complete"
