# Benchmark harness

The k6 load-test harness for the nextgen API ([ADR 067](../../docs/adrs/067-benchmark-harness-http-path-ownership.md),
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
  as a log line. The module reads its target from the k6 process environment,
  never from `__ENV`: the sweep passes it to the child process and runs k6
  with `--include-system-env-vars=false`, so the project secret shows up
  neither in a process listing nor to the script.
- `k6 x nextgen` — the command tree: `bootstrap` a target from a fixture
  file, `doctor` it, `sweep` every scenario at every VU count, `clean` up
  what bootstrap created, `summarize` a sweep directory. k6 does the
  aggregating: the script declares an empty threshold on every sub-metric the
  module lists (`nextgen.submetrics()`) — each request metric per operation,
  and `nextgen_errors` further per status class and per error code, from the
  vocabularies the module tags with — so k6's own end-of-test summary carries
  each operation on its own line with its error breakdown, and the sweep
  merges the per-run `--summary-export` documents into one table.

## Run it

A running, healthy server is the one prerequisite. The harness never starts
or stops one: the lane's provisioning tool does — Moon locally, a container
or a cloud deployment elsewhere — and the harness is pointed at it with
`--base`. Every command first checks that `/healthz` answers.

```sh
moon run workspace:server                              # terminal 1: the local server on :8080, migrated
moon run bench:sweep                                   # terminal 2: fixtures/local.json, 1/5/20 VUs × 20 s
moon run bench:sweep -- --vus 5 --duration 10s --scenarios getUser
moon run bench:sweep -- --base http://localhost:9090 --lane postgres   # any other server; later flags win
moon run bench:summarize -- dist/sweep-<stamp>          # rewrite summary.md / aggregate.json
```

`bench:sweep` builds the k6 binary (`dist/k6`) through Moon, then
`k6 x nextgen sweep --base …` provisions the fixture, runs the matrix one run
at a time — each run is `k6 run --scenario <name>` on the one entry script,
with the VU count and duration as `-e` — and writes `runs.json`, k6's summary export and console output
per run, `summary.md` and `aggregate.json`. `--raw` additionally keeps k6's
per-sample JSON output for every run. For a quieter server to measure, start
it with `instrumentation.log.level: warn` and the request stream off; the
default request log is a measured throughput cost.

Split provisioning from measuring:

```sh
dist/k6 x nextgen bootstrap --base http://localhost:8080               # provision only → dist/manifest.json
dist/k6 x nextgen sweep --manifest dist/manifest.json                   # reuse a provisioned target
dist/k6 x nextgen doctor --declare dialect=postgres --declare image_tag=v1.2.3 --declare replicas=3 --declare log_level=warn
dist/k6 x nextgen clean                                                # dry run: what would go
dist/k6 x nextgen clean --confirm                                      # remove it
```

Scenarios run one at a time on purpose: run together they contend for the
same machine and the cheap one starves the others.

## The manifest

`bootstrap` records everything it creates in a manifest (`dist/manifest.json`,
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
  asks the handoff exchange for a _shorter_ lifetime so rotation can be
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
it is a secret — the password only ever guards a user on a throwaway local
database. `bootstrap` applies the file over the API with the
generated client, then proves it by walking one login journey and one user
read, so a fixture that cannot be driven fails before anything is measured.

## Smoke lane

The harness is a nested Go module, so `go build ./...`, `go test ./...` and
`moon ci` at the repository root never compile it, and a renamed wire field,
a changed helper signature or a changed flow step would break it unnoticed.
The [`bench-smoke`](../../.github/workflows/bench-smoke.yml) workflow is what
notices: on pull requests touching `tools/`, `api/`, `internal/` or `cmd/`,
and before a release, it builds the server, starts it on SQLite with
[`ci/nextgen.yaml`](ci/nextgen.yaml) (the workflow owns that lifecycle, as the
lane's provisioning tool; the harness never starts a server) and runs

```sh
moon run bench:smoke -- --declare dialect=sqlite --declare image_tag=<sha> --declare replicas=1 --declare log_level=warn
# = dist/k6 x nextgen smoke --base http://localhost:8080 --fixtures fixtures/local.json …
```

which checks the server answers, runs `doctor`, bootstraps the smallest
fixture, runs **every registered scenario** at 5 VUs for 10 s each, asserts
the summary and discards it, then cleans up and asserts the target returned to
its starting counts (users, projects; the manifest lists nothing). Scenarios
come from the Go registry ([`harness/scenarios.go`](harness/scenarios.go),
`k6 x nextgen scenarios`), never from a list in the workflow: a scenario added
there is covered at once, and one registered without a function of its name in
`scripts/bench.js` fails the lane.

**It is not a performance gate.** No assertion is about how fast anything is —
no latency threshold, no throughput floor, no comparison with a previous run —
because a shared runner under contention cannot support one. It asserts that
the harness builds, runs, and emits what it claims to:

- one run per registered scenario, none missing, none extra;
- every operation of the scenario has samples, and its trends carry a full
  percentile set (a trend with no samples fails; it is not a zero);
- `http_req_failed` and the classified `nextgen_errors` counter at zero, no
  session cache misses or failed refreshes;
- the run metadata is populated: commit, lane, k6 version, and the doctor
  report with dialect, image tag, replicas and logging — facts the server does
  not report, so the lane declares them (`--declare`) and a missing one fails;
- the distinct time-series count is within a bound that grows with the
  operation list and never with the request volume (a path or id leaking into
  a tag fails it).

The lane never reports success without executing: the Moon task is
`cache: false`, `MOON_CACHE=off` covers the build steps, and the tests run with
`-count=1`. No artefact is uploaded and the temporary directory is removed
(`smoke --out DIR` keeps it for debugging).

## Layout

| Path                                   | What                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`cmd/k6/`](cmd/k6/)                   | the k6 binary with the module and the subcommand compiled in — what `xk6 build` would generate         |
| [`k6module/`](k6module/)               | `k6/x/nextgen`: root module (target, credentials, session cache), per-VU client, the delegating `Do`   |
| [`k6cmd/`](k6cmd/)                     | `k6 x nextgen bootstrap` / `sweep` / `summarize`                                                       |
| [`harness/`](harness/)                 | operations over the typed client, fixtures, target state, readiness check, sweep runner, summary merge |
| [`scripts/bench.js`](scripts/bench.js) | the one entry script (embedded into the binary)                                                        |
| [`fixtures/`](fixtures/)               | what a lane provisions                                                                                 |
| `dist/`                                | everything the tooling writes; gitignored at the root like every project's `dist/`                     |

## Checks

`moon run bench:test` (format, vet, unit tests) and `moon run bench:build`
run in CI through `moon ci`. No load is generated in CI.

## Licensing

This module is AGPL-3.0-only ([LICENSE](LICENSE)), like the server. It links
k6, which is AGPL-3.0-only, so unlike the rest of the product it cannot be
offered under a commercial license; see [LICENSING.md](../../LICENSING.md). It
is a development tool and is never part of a published package or image.
