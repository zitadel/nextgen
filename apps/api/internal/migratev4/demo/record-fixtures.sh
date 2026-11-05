#!/usr/bin/env bash
# Records the v4 fixtures the migration harness replays
# (internal/migratev4/e2e): for each seed profile, a fresh Zitadel v4 is
# started, seeded through its own APIs, stopped, and the two tables the
# migrator reads are dumped with the seed summary into
# ../testdata/<v4 version>/<profile>/.
#
# Run it from this directory when the pinned v4 version or seed-v4.mjs
# changes, and commit the result. It needs the same tools as the demo
# (README.md): Postgres with superuser `postgres`, the zitadel binary, Node,
# curl and nc. Each profile's database is dropped and recreated.
set -euo pipefail

: "${ZITADEL_BIN:?set ZITADEL_BIN to the zitadel v4.19.5 binary}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55432}" PGUSER="${PGUSER:-postgres}"
V4_VERSION="$("$ZITADEL_BIN" --version | awk '{print $NF}')"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/v4-fixtures.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

record() {
  local profile="$1" port="$2" seed_flag="$3"
  local db="v4fixture_$profile" out="$HERE/../testdata/$V4_VERSION/$profile"
  export V4_DB="$db" V4_PORT="$port" V4_DATA_DIR="$WORK/$profile"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"

  "$HERE/start-v4.sh" &
  local pid=$!
  until curl -fsS "http://localhost:$port/debug/ready" >/dev/null 2>&1; do
    kill -0 "$pid" 2>/dev/null || { echo "v4 exited; see $V4_DATA_DIR/zitadel.log" >&2; exit 1; }
    sleep 1
  done
  # shellcheck disable=SC2086 # seed_flag is empty or one flag
  node "$HERE/seed-v4.mjs" $seed_flag
  kill "$pid"
  wait "$pid" || true

  local instance
  instance="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).v4.instanceId)' "$V4_DATA_DIR/seed-summary.json")"
  mkdir -p "$out"
  # The instance's events and the system events that record v4's setup steps,
  # in the column order v4test.LoadFixture copies them back.
  psql -q -d "$db" -c "\\copy (SELECT instance_id, aggregate_type, aggregate_id, event_type, sequence, revision, created_at, payload, creator, owner, position, in_tx_order FROM eventstore.events2 WHERE instance_id IN ('$instance', '') ORDER BY position, in_tx_order) TO STDOUT WITH (FORMAT csv)" | gzip -n >"$out/events.csv.gz"
  psql -q -d "$db" -c "\\copy (SELECT id, key FROM system.encryption_keys ORDER BY id) TO STDOUT WITH (FORMAT csv)" >"$out/keys.csv"
  # The summary names the seeded users, passwords, secrets and links; the
  # local paths and URL of this run are dropped.
  node -e '
    const fs = require("fs");
    const summary = JSON.parse(fs.readFileSync(process.argv[1]));
    delete summary.v4.adminPatFile;
    delete summary.v4.url;
    fs.writeFileSync(process.argv[2], JSON.stringify(summary, null, 2) + "\n");
  ' "$V4_DATA_DIR/seed-summary.json" "$out/summary.json"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"
  echo "recorded $profile ($V4_VERSION, instance $instance) in $out"
}

record full 58190 ""
record supported 58191 "--supported"
