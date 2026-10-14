#!/usr/bin/env bash
# Starts the Postgres server of the postgres lane (server:test-postgres) in the
# background of a CI job.
#
# Used by .github/workflows/ci.yml and ci-turbo.yml right after checkout:
#
#   .github/scripts/postgres-lane-server.sh start
#
# The lane gives every test package a database of its own. testdb.PostgresDSN
# creates it on this server, which ZITADEL_TEST_POSTGRES_SERVER_URL names; the
# script exports the variable for the steps after it. Started per package as
# testcontainers, those databases waited for the image pull and, on Depot's EC2
# runners, for Docker's container create (#1835): a create waits until the root
# filesystem's dirty pages are on disk, and that disk (EBS) writes ~250 MB/s.
#
# Here the image is pulled at once, but the container is created only once the
# dirty page cache is below 256 MB, for 90 s at most: the job's cache restores
# leave several GB there. Created at once, the create waited 37-61 s for them,
# and the setup steps beside it ran ~4 s slower. Created later, it takes 2-8 s,
# and the server is up about when the lane first asks for it (a package waited
# 2 s at most). On Depot's microVMs, whose disks keep up, it starts at once.
#
# The data lives in memory (tmpfs). The host's network keeps Docker's port
# proxy out of the tests' way, and scram-sha-256 checks passwords as on a
# container's published port. The output goes to
# $RUNNER_TEMP/postgres-lane.log, which the workflows show when the job fails.
set -euo pipefail

port=15432

case "${1:-}" in
start)
  image="$(sed -n 's/^const containerImage = "\(.*\)"$/\1/p' internal/storage/testdb/postgres.go)"
  if [ -z "$image" ]; then
    echo "::warning::internal/storage/testdb/postgres.go has no containerImage constant; the lane starts its own containers"
    exit 0
  fi
  nohup "$0" serve "$image" </dev/null >"$RUNNER_TEMP/postgres-lane.log" 2>&1 &
  echo "ZITADEL_TEST_POSTGRES_SERVER_URL=postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable" >>"$GITHUB_ENV"
  ;;
serve)
  image=$2
  log() { echo "$(date -u +%T.%3N) $*"; }
  log "pulling $image"
  if docker pull --quiet "$image"; then
    log "pulled"
  else
    log "pull failed; docker run pulls again"
  fi
  waited=0
  while dirty=$(awk '/^Dirty:/ { print int($2 / 1024) }' /proc/meminfo) && [ "$dirty" -gt 256 ] && [ "$waited" -lt 180 ]; do
    sleep 0.5
    waited=$((waited + 1))
  done
  log "creating the container, ${dirty} MB of dirty page cache"
  for attempt in 1 2 3; do
    if docker run --detach --name postgres-lane --network host --tmpfs /var/lib/postgresql \
      --env POSTGRES_PASSWORD=postgres --env POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
      "$image" -c listen_addresses=127.0.0.1 -c port="$port" -c max_connections=500; then
      log "started"
      exit 0
    fi
    docker rm --force postgres-lane >/dev/null 2>&1 || true
    sleep $((attempt * 2))
  done
  log "gave up after 3 attempts"
  exit 1
  ;;
*)
  echo "usage: $0 start" >&2
  exit 2
  ;;
esac
