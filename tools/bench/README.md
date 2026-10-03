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
  file, `sweep` every scenario at every VU count, `summarize` a sweep
  directory k6 does the aggregating: the script declares one
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
out/k6 x nextgen sweep --base http://localhost:8080 --lane postgres   # provisions fixtures/local.json first
out/k6 x nextgen bootstrap --base http://localhost:8080               # provision only → out/target.json
out/k6 x nextgen sweep --state out/target.json                        # reuse a provisioned target
```

Scenarios run one at a time on purpose: run together they contend for the
same machine and the cheap one starves the others.

## Fixtures

[`fixtures/local.json`](fixtures/local.json) declares the project (name,
preview origins, seeded defaults) and the one user with a password. Nothing in
it is a secret — the password only ever guards a user on a database the sweep
creates and discards. `bootstrap` applies the file over the API with the
generated client, then proves it by walking one login journey and one user
read, so a fixture that cannot be driven fails before anything is measured.

## Layout

| Path                                   | What                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`cmd/k6/`](cmd/k6/)                   | the k6 binary with the module and the subcommand compiled in — what `xk6 build` would generate                |
| [`k6module/`](k6module/)               | `k6/x/nextgen`: root module (target, credential cache), per-VU client, the delegating `Do`                    |
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
