# ADR 067: Benchmark Harness — the Go Module Owns the Typed Call Path, k6 Performs the Request

> **Status:** Accepted
> **Date:** 2026-10-03
> **Context:** [#1095](https://github.com/zitadel/nextgen/issues/1095), the first decision of the benchmark epic [#1094](https://github.com/zitadel/nextgen/issues/1094); the decision and its evidence were posted on the issue on 2026-10-03 and are pinned here
> **Builds on:** [ADR 002](002-multi-package-release-strategy.md) (Moon owns the task graph), [ADR 028](028-storage-v2-statements-and-dialects.md) (SQLite is the local default and not a production peer)
> **Related:** [#1096](https://github.com/zitadel/nextgen/issues/1096), [#1104](https://github.com/zitadel/nextgen/issues/1104), [#1105](https://github.com/zitadel/nextgen/issues/1105), [#1107](https://github.com/zitadel/nextgen/issues/1107), [LICENSING.md](../../LICENSING.md)

## Context

The benchmark epic chose k6 as the execution engine and a Go xk6 module as
the place where scenarios, fixtures, credentials and metrics live. That left
one question open, and it shapes everything built on top: **how much of the
HTTP path does the Go module own?**

Two shapes were posed:

- **Owned.** The module issues the requests itself. It can use the generated
  ogen client end to end, hold a process-wide credential cache, and tag its
  own metrics. The assumed cost was losing k6's HTTP instrumentation — the
  `http_req_blocked` / `connecting` / `sending` / `waiting` / `receiving`
  breakdown, the per-VU cookie jar, and k6's connection-reuse behaviour.
- **Prepared.** The module prepares requests and verifies responses while
  `k6/http` performs them from JavaScript. k6's instrumentation is retained;
  the typed client cannot be used for the call, and the credential cache has
  to be reachable from JavaScript.

Both were prototyped against the same three operations — `POST /flow`,
`POST /flow/{id}/submit` (identifier and password) and `GET /users/{id}` —
on a local SQLite server at 1, 5 and 20 VUs, and compared on phase-breakdown
fidelity, cookie handling, connection reuse, lines of JavaScript, and tag
cardinality. The prototype is on branch
`muhlemmer/spike-1095-http-ownership` (not merged); its measured results are
in that branch's `tools/bench/spike/RESULTS.md`.

Two facts found while prototyping dissolved the dichotomy:

1. k6's request path is a public Go function. `httpext.MakeRequest` in
   `go.k6.io/k6/v2/lib/netext/httpext` is what `k6/http` calls from
   JavaScript; it takes a `*http.Request` and the VU's `lib.State` and does
   everything k6 does — transport, tracer, cookie jar, `http_req_*` samples,
   failure classification. `httpext.Tracer`, the `httptrace` hook behind the
   phase breakdown, is exported as well.
2. The generated client has exactly one seam: `WithClient(Do)`. ogen encodes
   the request, calls `Do`, and decodes the response. There is no
   build-without-send, so the _prepared_ shape cannot use the typed client
   for the call at all; but `Do` is enough to hand the call to k6.

## Decision

### 1. The module drives the generated client; the client's `Do` hands the request to k6

Every operation a scenario performs is a call on the generated ogen client,
made from Go. The client is constructed per VU with
`api.WithClient(doer)`, where `doer.Do` reads the request's body into a
buffer, sets the tags, and calls `httpext.MakeRequest` with the VU's
`lib.State`. k6 performs the request. The result is converted back into an
`*http.Response` for the generated decoder.

The entry script is one JavaScript call per logical operation:

```js
import nextgen from "k6/x/nextgen";
export function login() {
  nextgen.login();
}
```

Request encoding, response decoding, the operation vocabulary, error
classification and the credential cache are therefore all Go. k6 owns the
transport, the tracer, the per-VU cookie jar, the built-in `http_req_*`
metrics and `http_req_failed`.

### 2. Operation ids are the tag vocabulary; paths never are

Each typed call carries its operation id in the context (`harness.WithOp`),
and `Do` sets it as the `op` tag **and** as k6's `name` system tag. With a
manually set `name`, k6 sets the `url` system tag to the same value, so no
sample ever carries a raw path. The number of time series a run emits is
bounded by the operation list, not by the dataset; this is the property
[#1104](https://github.com/zitadel/nextgen/issues/1104) asks a test to
assert, and `k6module` tests it at the request layer. Raw per-sample output
stays opt-in (`sweep --raw`) for asserting it on a real dataset.

### 3. Built-in metrics are the metrics, and k6 aggregates them

Because k6 performs the call, the `http_req_*` names are the honest ones and
are not duplicated under module names. Module metrics exist only for what k6
cannot know: `nextgen_errors` counts failed operations classified by status
class and the error-details `code` of the body (k6 sees a step re-served
with an error key as a plain 200), and later the credential refresh cost for
[#1107](https://github.com/zitadel/nextgen/issues/1107). Such a metric is
registered once on the root module and pushed from each VU through its
sample channel, so thresholds and the summary treat it like a built-in. Aggregation is
k6's as well: the entry script declares an empty threshold on every
sub-metric the module lists — `metric{op:<id>}` for every operation and
request metric, and `nextgen_errors` further per status class and per error
code, from the bounded vocabularies the module tags with — so k6's own
end-of-test summary reports each operation on its own line with its error
breakdown, and a sweep is merged from the per-run `--summary-export`
documents rather than re-aggregated from raw samples.

### 4. The credential cache is the generated client's `SecuritySource`

It lives on the root module value, once per process, shared by every VU, and
is never surfaced to JavaScript. Today it holds the project secret; the
refreshing session cache of #1107 slots into the same type.

### 5. Provisioning is declared in JSON and applied through the typed client

A fixture file declares the project and user a lane needs; `k6 x nextgen
bootstrap` applies it over the API with the same generated client and proves
the result by walking one login journey before anything is measured. The
provisioned target, with the project secret, reaches a k6 run through the
child process environment and is read on the Go side; it is never a `-e`
value, so it appears neither in a process listing nor in the script's
`__ENV`. There
is no shell in the path: the local sweep (`moon run bench:sweep`) builds the
k6 binary through Moon and the `sweep` command provisions, measures and
summarises. A running, healthy server is a prerequisite of the harness,
never its job: the provisioning tool of each lane starts it — Moon locally
(`moon run workspace:server`), a container or a cloud deployment on the
other lanes — and the harness is pointed at it, checking `/healthz` before
anything else.

### 6. The harness is a nested Go module under `tools/bench`

k6 is AGPL-3.0-only. Keeping it out of the root `go.mod` keeps it out of the
server's dependency graph; a nested module whose path begins with
`github.com/zitadel/zitadel/v5/` can still import the root module's `internal/`
packages. The module is AGPL-3.0-only like the server, and because it links
k6 it is additionally excluded from any commercial licensing of the product
([LICENSING.md](../../LICENSING.md)). The k6 version is pinned in its
`go.mod`; `lib/netext/httpext` is importable but not a documented extension
API, so a k6 upgrade is expected to touch `Do`.

## Evidence

Measured 2026-10-02 on a workstation against a local SQLite server from
`main@b44b907bd`, one scenario at a time, 20 s per run, 25 runs, zero failed
requests.

| Criterion                      | owned                                                                                                                                                         | **delegated (chosen)**                                             | prepared                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Phase breakdown                | identical to k6's — it _is_ `httpext.Tracer` behind `httptrace`; p95 at 1 VU `GET /users/{id}`: blocked 3 µs, sending 12 µs, waiting 1.21 ms, receiving 31 µs | k6's own: 3 µs / 17 µs / 1.25 ms / 43 µs                           | k6's own: 3 µs / 9 µs / 1.16 ms / 34 µs                                                                               |
| Cookies                        | `_zflow` is an explicit ogen parameter; jar unused                                                                                                            | jar held `_zflow` on 100 % of flows; explicit parameter also works | jar, implicit                                                                                                         |
| Connection reuse / latency     | 98–100 % reused; a process-wide transport changed nothing                                                                                                     | k6's transport                                                     | k6's transport                                                                                                        |
| JavaScript in the entry script | 9 lines                                                                                                                                                       | 9 lines                                                            | 21 lines                                                                                                              |
| Tag cardinality                | bounded in Go: 15 series (`getUser`), 33 (`login`) at every VU count                                                                                          | 15 / 34                                                            | 33 only if the script passes the module's `name` tag; with plain `k6/http` params, **10,041 series in 20 s** at 5 VUs |

Latency and throughput did not separate the shapes at any VU count
(`GET /users/{id}` at 20 VUs: 1,792 / 1,775 / 1,709 req/s delegated / owned /
prepared, p95 20.0 / 20.4 / 21.3 ms; the login journey: 66 iterations/s on
every shape). The load generator is not where the time goes.

## Alternatives considered

- **Owned** buys nothing measurable and costs reimplementing what k6 does per
  request — the nine-sample emission, failure classification, k6 error codes,
  the `name`/`url`/`status` system-tag handling, HTTP debug output — and
  forces a second metric vocabulary (`nextgen_req_*`) next to k6's.
- **Prepared** cannot use the typed client for the call, so the module
  restates each operation's method, path and content type by hand beside the
  generated encoder. Cardinality control becomes a convention scenario
  authors must follow in JavaScript rather than a property of the module, and
  the credential crosses into JavaScript as a plain string in request params.

## Consequences

- `httpext.Response` flattens repeated headers into one comma-joined string.
  Cookies survive separately, so `Do` rebuilds `Set-Cookie` from
  `resp.Cookies` before decoding. Only operations whose typed response reads a
  multi-valued header are affected; on the first-wave surface that is the
  flow cookie alone.
- k6 v2 mounts extension subcommands under `k6 x <name>`, so the command tree
  is `k6 x nextgen …`, not `k6 nextgen …` as #1096 assumed.
- The custom binary is built with `go build ./cmd/k6` from the nested module
  rather than `xk6 build`: that is what xk6 would generate, and building it
  directly keeps the module's `replace` of the root module in force.
- A scenario that needs an operation the generated client lacks has no
  fallback to raw `k6/http`; it adds the operation to the OpenAPI source
  first, which is the right order anyway.
