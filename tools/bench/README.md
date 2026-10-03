# Benchmark harness

The k6 load-test harness for the nextgen API ([ADR 066](../../docs/adrs/066-benchmark-harness-http-path-ownership.md),
epic [#1094](https://github.com/zitadel/nextgen/issues/1094)). A nested Go
module that compiles two things into one k6 binary:

- `k6/x/nextgen` — the JavaScript module the scenarios call. Every operation
  is a call on the generated ogen client made from Go; the client's `Do`
  hands the request to k6's own `httpext.MakeRequest`, so k6 performs it and
  the built-in `http_req_*` metrics, cookie jar and failure classification
  apply. Tags are bounded by construction: `op`, `lane`, and k6's `name`/`url`
  set to the operation id, never a path. A failed operation is counted on the
  module's `nextgen_errors` counter, tagged `op`, `lane`, `status_class` and
  the error-details `code` (or `flow.step_error` for a step re-served with an
  error key), so it appears in the summary as a classified error rather than
  as a log line.
- `k6 x nextgen` — the command tree: `bootstrap` a target from a fixture
  file, `doctor` it, `sweep` every scenario at every VU count, `clean` up
  what bootstrap created, `summarize` a sweep directory. k6 does the aggregating: the script declares one
  `metric{op:<id>}` sub-metric per operation, so k6's own end-of-test summary
  reports each operation on its own line, and the sweep merges the per-run
  `--summary-export` documents into one table.

## Run it

```sh
moon run bench:sweep                                   # local: SQLite server, fixtures/local.json, 1/5/20 VUs × 20 s
moon run bench:sweep -- --vus 5 --duration 10s --scenarios getUser
moon run bench:summarize -- out/sweep-<stamp>          # rewrite summary.md / aggregate.json
```

`bench:sweep` builds the k6 binary (`out/k6`) and the server
(`out/nextgen-server`) through Moon, then `k6 x nextgen sweep --server …`
starts the server on SQLite in a fresh data directory with migrations
applied and both embedded UIs off, provisions the fixture, runs the matrix
one run at a time, writes `runs.json`, k6's summary export and console
output per run, `summary.md` and `aggregate.json`, and stops the server.
`--raw` additionally keeps k6's per-sample JSON output for every run.

Against a server you already run:

```sh
out/k6 x nextgen sweep --base http://localhost:8080 --lane postgres   # provisions fixtures/local.json into out/manifest.json first
out/k6 x nextgen bootstrap --base http://localhost:8080               # provision only → out/manifest.json
out/k6 x nextgen sweep --manifest out/manifest.json                   # reuse a provisioned target
out/k6 x nextgen doctor --declare dialect=postgres --declare image_tag=v1.2.3 --declare replicas=3 --declare log_level=warn
out/k6 x nextgen clean                                                # dry run: what would go
out/k6 x nextgen clean --confirm                                      # remove it
```

Scenarios run one at a time on purpose: run together they contend for the
same machine and the cheap one starves the others.

## The manifest

`bootstrap` records everything it creates in a manifest (`out/manifest.json`,
owner-readable only because it holds the project secret): the target, the
project, every user and the session its proof login opened. `clean`, `doctor`
and the scenarios read it, so no scenario invents an identifier. Bootstrapping
again against the same manifest is idempotent — the project is reused, users
the target still has are kept, and only missing ones are created; a manifest
written for another target, or whose project the target no longer has, is an
error naming the file to remove.

## Clean

`clean` removes what the manifest names, and only that. A user is deleted only
when the manifest lists it **and** its address matches the naming convention in
full (`bench-…` projects, `…@bench.local` addresses; anchored patterns, never a
prefix or substring match) — the manifest is a file anyone can edit, and the
convention alone would match lookalikes. A project that does not follow the
convention is not followed to its users at all. Without `--confirm` it only
prints what it would do. It refuses while a sweep or bootstrap holds the run
lock (`<manifest>.lock`, a pid file; a lock whose process is gone is taken
over).

The API has no delete-project operation, so the project stays after `clean`,
recorded in the manifest, and the next `bootstrap` reuses it instead of
leaking another. Users and sessions return to their starting counts; the
local sweep's throwaway data directory takes the project with it.

## Doctor

`doctor` is the record of what a benchmark ran against, and a sweep runs it
before its first run and keeps the report in `runs.json` and `summary.md`.
It **observes** reachability (`/livez`, `/readyz`, `/healthz`), the HTTP
protocol and whether the manifest's fixtures exist. The server does not
report its dialect, image tag, replica count or logging, so those are taken
from `--declare name=value` and each is marked `[declared]` — or `[harness]`
when the sweep started the server itself and configured them, or `[unknown]`
with a warning when nobody said. Anything else declared (for example
`session.default_ttl=10m`) is recorded as given.

## Sessions

The session token is the credential that expires (`session.default_ttl`, ten
minutes by default); the project secret does not rotate. A scenario that needs
a session takes it from the process-wide `SessionCache` on the root module,
never by logging in inside the iteration — a re-login there would put a
periodic spike on whatever operation came next, aligned across VUs because
their TTLs align.

- **Warm, then rotate.** `setup()` establishes the sessions before anything is
  measured. A background path then re-establishes each one `--session-margin`
  (default 60s) before it expires. The logins use plain `net/http`, so they
  emit no `http_req_*` samples; their cost is on its own metrics,
  `nextgen_session_refresh_duration` (tagged `result`, `path`) and
  `nextgen_session_refreshes`, and is in no operation trend.
- **Misses invalidate the window.** A `Get` that finds no usable session pays
  for a login on the measured path. It is counted on
  `nextgen_session_cache_miss`, `summary.md` marks the run `INVALID`, and the
  sweep exits non-zero after writing everything. It is never absorbed.
- **One login per credential.** Concurrent refreshes of the same slot, a miss
  racing the background path included, share one login journey.
- **Affinity and capacity.** `--session-affinity shared` (default) is one
  session reused by every VU; `vu` is one session per VU. They measure
  different things, so the scenario chooses. `--session-capacity` bounds the
  slots; asking for more is an error, not an eviction, because an eviction
  would put a login back on the measured path.
- **Not the default TTL.** The target's TTL is not raised. `--session-ttl`
  asks the handoff exchange for a *shorter* lifetime so rotation can be
  watched within minutes, and is recorded in `runs.json`; a session that
  lives no longer than the margin is refused.

`getMySession` (`GET /sessions/me` with a cached session) is the scenario that
uses it:

```sh
moon run bench:sweep -- --scenarios getMySession --vus 5 --duration 30m --session-affinity vu
```

A session replaced by a refresh is left to expire server-side; deleting the
user (`clean`) removes the rest.

## Fixtures

[`fixtures/local.json`](fixtures/local.json) declares the project (name,
preview origins, seeded defaults), the primary user with a password and,
optionally, `population.count` further users (`bench-user-00001@bench.local`,
…) sharing that password. Names must follow the convention `clean` enforces. Nothing in
it is a secret — the password only ever guards a user on a database the sweep
creates and discards. `bootstrap` applies the file over the API with the
generated client, then proves it by walking one login journey and one user
read, so a fixture that cannot be driven fails before anything is measured.

## Layout

| Path                                   | What                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`cmd/k6/`](cmd/k6/)                   | the k6 binary with the module and the subcommand compiled in — what `xk6 build` would generate                |
| [`k6module/`](k6module/)               | `k6/x/nextgen`: root module (target, credentials, session cache), per-VU client, the delegating `Do`         |
| [`k6cmd/`](k6cmd/)                     | `k6 x nextgen bootstrap` / `sweep` / `summarize`                                                              |
| [`harness/`](harness/)                 | operations over the typed client, fixtures, target state, local server lifecycle, sweep runner, summary merge |
| [`scripts/bench.js`](scripts/bench.js) | the one entry script (embedded into the binary)                                                               |
| [`fixtures/`](fixtures/)               | what a lane provisions                                                                                        |
| `out/`                                 | everything the tooling writes; gitignored                                                                     |

## Checks

`moon run bench:test` (format, vet, unit tests) and `moon run bench:build`
run in CI through `moon ci`. No load is generated in CI.

## Licensing

This module is AGPL-3.0-only ([LICENSE](LICENSE)), like the server. It links
k6, which is AGPL-3.0-only, so unlike the rest of the product it cannot be
offered under a commercial license; see [LICENSING.md](../../LICENSING.md). It
is a development tool and is never part of a published package or image.
