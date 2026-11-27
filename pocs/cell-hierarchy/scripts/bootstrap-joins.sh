#!/usr/bin/env bash
set -euo pipefail

join() {
  local parent_url="$1"
  local child_url="$2"
  local label="$3"
  echo "join $label -> $parent_url"
  local invite token parent
  invite="$(curl -fsS -X POST "$parent_url/v1/join/prepare" -H 'Content-Type: application/json' -d '{}')"
  token="$(printf '%s' "$invite" | jq -r .join_token)"
  parent="$(printf '%s' "$invite" | jq -r .parent_url)"
  if [[ -z "$token" || "$token" == "null" || -z "$parent" || "$parent" == "null" ]]; then
    echo "failed to parse invite: $invite" >&2
    exit 1
  fi
  curl -fsS -X POST "$child_url/v1/join/accept" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg p "$parent" --arg t "$token" '{parent_url:$p, join_token:$t}')" >/dev/null
  echo "  ok"
}

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

PLATFORM="${PLATFORM_URL:-http://platform:8100}"
EU="${EU_URL:-http://eu:8101}"
EU1="${EU1_URL:-http://eu-1:8102}"
EU2="${EU2_URL:-http://eu-2:8103}"
US="${US_URL:-http://us:8104}"
AUS="${AUS_URL:-http://aus:8105}"

for u in "$PLATFORM" "$EU" "$EU1" "$EU2" "$US" "$AUS"; do
  wait_healthy "$u"
done

join_ok() {
  local parent_url="$1"
  local child_url="$2"
  local label="$3"
  if curl -fsS "$child_url/v1/me" | grep -q '"status":"joined"'; then
    echo "skip $label (already joined)"
    return 0
  fi
  join "$parent_url" "$child_url" "$label" || {
    if curl -fsS "$child_url/v1/me" | grep -q '"status":"joined"'; then
      echo "skip $label (joined during race)"
      return 0
    fi
    return 1
  }
}

join_ok "$PLATFORM" "$EU" "eu"
join_ok "$EU" "$EU1" "eu-1"
join_ok "$EU" "$EU2" "eu-2"
join_ok "$PLATFORM" "$US" "us"
join_ok "$PLATFORM" "$AUS" "aus"

echo "bootstrap complete"
