# PoW protocol comparison

Research harness for [ADR 019](../../docs/adrs/019-captcha-gate-and-bot-signals.md).
It does not implement product admission, storage, rate limits or key management.
All challenge keys and scope values are public synthetic fixtures.

From an installed workspace, install Playwright's engines once, then use Moon:

```sh
pnpm exec playwright install chromium firefox webkit
moon run pow-bench:test
moon run pow-bench:matched
node tools/pow-bench/matched-summary.mjs
# Original SHA-versus-library comparison:
moon run pow-bench:run
node tools/pow-bench/summarize.mjs
```

`run` builds the isolated Go module, creates 32 challenges per candidate, solves
them in Go, measures issuance/verification, then solves the **same challenges**
in each browser and verifies every browser proof in Go. Browsers run serially;
each variant has one worker and an excluded warm-up. Outputs are in ignored
`dist/`. `test` runs Go negative cases and the cross-engine digest, worker-start,
CSP and cancellation smoke checks, Go vet and two five-second decoder fuzz runs without replacing benchmark results.

`matched` runs 32 paired puzzles per profile: own and ALTCHA PBKDF2 (5,000
iterations) plus Argon2id (one pass, one lane, 4/16/64 MiB), each at four search
levels. A pair shares salt, nonce, counter, prefix and derived key. Execution
order alternates; shared random quantiles control counter luck across levels.
Go crypto/pbkdf2 and x/crypto/argon2 are used by both Go paths; WebCrypto PBKDF2
and hash-wasm Argon2id by both browser paths. Own means our protocol/solver, not
our cryptographic primitive. No product server is started.

The runner verifies all successful browser proofs in Go, records unavailable
engines and 30-second diagnostic timeouts, checks CSP without the WASM allowance,
and runs separate issuer processes at concurrency 1/4/8 for sampled heap and
Darwin max RSS. Browser linear-memory observations cover allocations within one
KDF call, not total browser RSS. The tracker releases references between calls;
hash-wasm creates new instances per call. Do not run another benchmark or load
test alongside it. `--browsers-only` reuses `dist/matched/matched-corpus.json`.
Both corpus formats use synthetic 24-hour expiry solely to permit measurement.

The [matched results](results/2026-11-02-matched-macos-arm64/summary.md) and
[decision report](../../docs/design/flowengine/pow-matched-benchmark-2026-11-02.md)
record the selected own PBKDF2 construction, exact scope and remaining release
gates. Regenerate the archived matched summary with:

```sh
node tools/pow-bench/matched-summary.mjs tools/pow-bench/results/2026-11-02-matched-macos-arm64
```

The measured candidate identifiers (`zitadel_kdf_candidate_v1`, `pbkdf2_5000_lN`)
are research fixture labels. ADR 019 defines the product names and fuller
binding context. This harness deliberately does not claim to exercise product
key management, database replay prevention, CEL or atomic admission. `matched_test.go`
covers cross-implementation KDF framing, scope/level/expiry tampering and strict
proof parsing. The latter rejects Go JSON's usual case-insensitive aliases.

Optional environment variables:

- `POW_BENCH_SAMPLES`: challenges per candidate, default 32.
- `POW_BENCH_BROWSERS`: comma-separated Playwright engines; default
  `chromium,firefox,webkit`. Explicitly report omitted engines.
- `POW_BENCH_NODE_MODULES`: an isolated tooling installation instead of workspace
  dependencies. The recorded run used this equivalent temporary installation
  via an ignored local `node_modules` symlink, because this checkout was uninstalled.
- `GOMODCACHE`, `GOCACHE`, `PLAYWRIGHT_BROWSERS_PATH`: standard tooling overrides.

`moon run pow-bench:run -- --browsers-only` reuses `dist/corpus.json`; its synthetic
challenges expire after 24 hours. Product expiry is **not** 24 hours. Rerun the
whole benchmark after expiry. The fixed SHA digest and ALTCHA PBKDF2 derivation vectors never expire;
the latter exercises byte encoding without time-dependent admission.

The [recorded run](results/2026-11-02-macos-arm64/summary.md) and
[interpretation](../../docs/design/flowengine/pow-benchmark-2026-11-02.md) include
versions, raw samples, methodology and limitations. Regenerate a summary from
archived samples with:

```sh
node tools/pow-bench/summarize.mjs tools/pow-bench/results/2026-11-02-macos-arm64
```

The Go ALTCHA dependency is pinned to **v2.4.1**. The run used `altcha-lib` **2.8.0**,
`@noble/hashes` **2.4.0**, Playwright **1.64.1**, esbuild **0.28.1**, go-jose **4.1.6**,
Go **1.26.9**, Node **24.22.0**. The matched run additionally uses MIT-licensed
`hash-wasm` **4.12.0** and x/crypto **0.54.0**. JS dependency ranges follow the workspace catalog;
record actual resolved versions for every new result. Do not substitute the
retracted ALTCHA Go v2.0.0–v2.3.0 releases.

This code is under the repository's AGPL default. A future MIT browser package
must implement the documented protocol against an appropriately licensed library;
do not copy this harness into it. ALTCHA, noble/hashes and hash-wasm are MIT dependencies.
