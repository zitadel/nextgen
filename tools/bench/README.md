# Benchmark harness spike — issue #1095

Throwaway prototype answering one question: **how much of the HTTP path should
the xk6 Go module own?** Not for merging; the decision is recorded on the
issue. The nested module layout (`tools/bench`, `k6/x/…` registration) is the
shape #1096 will build for real.

## What is here

One k6 JavaScript module, `k6/x/nextgen-spike`, exposing the same three
operations — `POST /flow`, `POST /flow/{id}/submit`, `GET /users/{id}` — in
three request shapes:

| Shape | Who performs the call | Typed client | Metrics | Cookie | Entry script |
|---|---|---|---|---|---|
| `owned` | the Go module, over k6's per-VU transport (`NEXTGEN_OWNED_TRANSPORT=shared` swaps in one process-wide `http.Transport`) | ogen client, all of it | module's own `nextgen_req_*`, phases from `net/http/httptrace` via k6's `httpext.Tracer` | explicit ogen parameter; module carries the value | [owned.js](spike/scripts/owned.js) |
| `delegated` | k6's `httpext.MakeRequest`, handed the `*http.Request` the ogen client built | ogen client, all of it (its `Do` is replaced) | k6's built-in `http_req_*` | k6's per-VU jar **and** the explicit parameter | [delegated.js](spike/scripts/delegated.js) |
| `prepared` | `k6/http` from JavaScript | ogen encoders/decoders only; method, path and content type restated by hand | k6's built-in `http_req_*` | k6's per-VU jar | [prepared.js](spike/scripts/prepared.js) |

[prepared-naive.js](spike/scripts/prepared-naive.js) is `prepared` without the
module's bounded tags, to measure the time-series count a plain `k6/http`
script produces on `/flow/{id}/submit`.

Source: [spike/module.go](spike/module.go) (root module, config, credential
cache, custom metrics), [owned.go](spike/owned.go), [delegated.go](spike/delegated.go),
[prepared.go](spike/prepared.go), [journey.go](spike/journey.go) (the login
journey over the typed client, shared by `owned` and `delegated`).

## Running it

```sh
cd tools/bench
go build -o out/k6 ./cmd/k6          # k6 v2.3.0 with the module compiled in
spike/scripts/bootstrap.sh           # build + migrate + start the server on SQLite (:8099), seed, prove one login
spike/scripts/sweep.sh --dur 20s     # every shape × scenario × {1,5,20} VUs, raw JSON per run
spike/scripts/aggregate.py out/sweep-<stamp>   # the comparison table
systemctl --user stop nextgen-spike-8099       # when done
```

`cmd/k6/main.go` is what `xk6 build` would generate; building it directly keeps
this module's `replace github.com/zitadel/nextgen => ../..` in force. Pinning
xk6 is #1096's job.

The server runs as a transient user unit with `console_enabled`/`login_enabled`
off (the embedded UI builds are not needed for the API), `log.level: warn` and
only the `runtime`/`ready` log streams, because the default request logging is
the throughput cost measured on 2026-09-01.

Two things the bootstrap learned the hard way, both worth knowing on `main`:

- The server no longer migrates on start; `nextgen-server migrate -c …` is a
  separate step. Without it the start fails with
  `failed to bootstrap platform project … failed to create project in the database`.
- That fatal startup error is logged at **INFO**, so with `level: warn` the
  process exits silently with status 1.
