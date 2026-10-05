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
  as a log line. The module reads its target from the k6 process environment,
  never from `__ENV`: the sweep passes it to the child process and runs k6
  with `--include-system-env-vars=false`, so the project secret shows up
  neither in a process listing nor to the script.
- `k6 x nextgen` — the command tree: `bootstrap` a target from a fixture
  file, `sweep` every scenario at every VU count, `summarize` a sweep
  directory. k6 does the aggregating: the script declares an empty threshold
  on every sub-metric the module lists (`nextgen.submetrics()`) — each
  request metric per operation, and `nextgen_errors` further per status
  class and per error code, from the vocabularies the module tags with — so
  k6's own end-of-test summary carries each operation on its own line with
  its error breakdown, and the sweep merges the per-run `--summary-export`
  documents into one table.

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
moon run bench:summarize -- out/sweep-<stamp>          # rewrite summary.md / aggregate.json
```

`bench:sweep` builds the k6 binary (`out/k6`) through Moon, then
`k6 x nextgen sweep --base …` provisions the fixture, runs the matrix one run
at a time, and writes `runs.json`, k6's summary export and console output
per run, `summary.md` and `aggregate.json`. `--raw` additionally keeps k6's
per-sample JSON output for every run. For a quieter server to measure, start
it with `instrumentation.log.level: warn` and the request stream off; the
default request log is a measured throughput cost.

Split provisioning from measuring:

```sh
out/k6 x nextgen bootstrap --base http://localhost:8080               # provision only → out/target.json
out/k6 x nextgen sweep --state out/target.json                        # reuse a provisioned target
```

Scenarios run one at a time on purpose: run together they contend for the
same machine and the cheap one starves the others.

## Fixtures

[`fixtures/local.json`](fixtures/local.json) declares the project (name,
preview origins, seeded defaults) and the one user with a password. Nothing in
it is a secret — the password only ever guards a user on a throwaway local
database. `bootstrap` applies the file over the API with the
generated client, then proves it by walking one login journey and one user
read, so a fixture that cannot be driven fails before anything is measured.

## Layout

| Path                                   | What                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`cmd/k6/`](cmd/k6/)                   | the k6 binary with the module and the subcommand compiled in — what `xk6 build` would generate         |
| [`k6module/`](k6module/)               | `k6/x/nextgen`: root module (target, credential cache), per-VU client, the delegating `Do`             |
| [`k6cmd/`](k6cmd/)                     | `k6 x nextgen bootstrap` / `sweep` / `summarize`                                                       |
| [`harness/`](harness/)                 | operations over the typed client, fixtures, target state, readiness check, sweep runner, summary merge |
| [`scripts/bench.js`](scripts/bench.js) | the one entry script (embedded into the binary)                                                        |
| [`fixtures/`](fixtures/)               | what a lane provisions                                                                                 |
| `out/`                                 | everything the tooling writes; gitignored                                                              |

## Checks

`moon run bench:test` (format, vet, unit tests) and `moon run bench:build`
run in CI through `moon ci`. No load is generated in CI.

## Licensing

This module is AGPL-3.0-only ([LICENSE](LICENSE)), like the server. It links
k6, which is AGPL-3.0-only, so unlike the rest of the product it cannot be
offered under a commercial license; see [LICENSING.md](../../LICENSING.md). It
is a development tool and is never part of a published package or image.
