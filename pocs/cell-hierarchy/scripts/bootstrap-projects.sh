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
  local team="${7:-}"
  if curl -fsS "$cell_url/v1/projects/$id" >/dev/null 2>&1; then
    echo "skip project $id (exists on $cell_url)"
    return 0
  fi
  echo "create project $id on $cell_url (lookup=$lookup workspace=$workspace team=$team)"
  curl -fsS -X POST "$cell_url/v1/projects" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg id "$id" \
      --arg name "$name" \
      --arg ws "$workspace" \
      --arg team "$team" \
      --argjson parent "$is_parent" \
      --argjson lookup "$lookup" \
      '{id:$id, name:$name, is_parent:$parent, lookup_enabled:$lookup, workspace_id:$ws, customer_team_id:$team}')" >/dev/null
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

create_team() {
  local cell_url="$1"
  local project_id="$2"
  local id="$3"
  local name="$4"
  local teams
  teams="$(curl -fsS "$cell_url/v1/projects/$project_id/teams")"
  if printf '%s' "$teams" | jq -e --arg id "$id" '.teams[]? | select(.id == $id)' >/dev/null 2>&1; then
    echo "skip team $id on $project_id"
    return 0
  fi
  echo "create team $id ($name) on $project_id"
  curl -fsS -X POST "$cell_url/v1/projects/$project_id/teams" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg id "$id" --arg name "$name" '{id:$id, name:$name}')" >/dev/null
}

PLATFORM="${PLATFORM_URL:-http://platform:8100}"
EU1="${EU1_URL:-http://eu-1:8101}"
EU2="${EU2_URL:-http://eu-2:8102}"
US1="${US1_URL:-http://us-1:8103}"
US2="${US2_URL:-http://us-2:8104}"

for u in "$PLATFORM" "$EU1" "$EU2" "$US1" "$US2"; do
  wait_healthy "$u"
done

# Hoster: platform project (lookup zone) + customer team acme.
# Customer: optional root workspace/site "acme" on eu-1 attached to platform.
# Expand further sites (US-2, US-2-1, …) from the site page UI — parent picker.
# Users + lookup only; no apps/tuples/groups seeded.
create_project "$PLATFORM" "platform" "platform" true true "" ""
create_team "$PLATFORM" "platform" "acme" "acme"

create_project "$EU1" "acme" "acme" false true "acme" "acme"
attach_project "$EU1" "acme" "platform" "$PLATFORM"

echo "project bootstrap complete (platform + team acme + workspace/site acme @ eu-1)"
echo "Next: open /projects/acme → create user → add child site → lookup from sibling"
