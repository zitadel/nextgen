# Matched PBKDF2 and Argon2id benchmark — 2026-11-02

> **Status:** Stage 1 desktop measurement complete; v1 protocol selected.
> **Decision:** Own precomputed PBKDF2; ALTCHA stays a research dependency; Argon2id remains experimental.
> **Follow-up:** [Implementation and algorithm extensibility plan](bot-protection-implementation.md); measurement data below is unchanged.
> **Contract:** [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md).

## Decision and its limits

Build the ZITADEL-owned bounded-search protocol around standard PBKDF2-HMAC-
SHA-256, using Go's standard library and browser WebCrypto. The matched tests
remove the algorithm/library confounding in the [original comparison](pow-benchmark-2026-11-02.md).
ALTCHA's matching solver has essentially the same solve cost. Its generic
verification/serialization path has more overhead than our typed adapter; it does
not supply a unique KDF advantage that requires adopting its wire protocol.

Argon2id works in our adapter and ALTCHA, using the same Go and WASM primitives.
The reason to defer it is issuer CPU/RAM, browser WASM/CSP requirements and missing
attacker-cost/device evidence. Fast Argon2 browser results below use much shorter
searches; they do not establish equal security or equal economic cost to PBKDF2.
These are exploratory PoW parameters, not password-storage recommendations.
This decision does not change the password-hashing policy in ADR 029.

Own means protocol/solver ownership, not a new cryptographic primitive. We take
responsibility for review, fixed vectors, byte framing, binding, upgrades and
malformed-input handling. ALTCHA is a useful maintained reference, not an unsafe
library rejected by this measurement. Its larger feature surface is unnecessary
for the selected v1 contract. Nothing in this research package ships in the
product; no ALTCHA server or external verification service was used.

## Reproducible method

The [raw corpus](../../../tools/pow-bench/results/2026-11-02-matched-macos-arm64/matched-corpus.json),
[browser/memory samples](../../../tools/pow-bench/results/2026-11-02-matched-macos-arm64/matched-browser-results.json)
and [complete generated tables](../../../tools/pow-bench/results/2026-11-02-matched-macos-arm64/summary.md)
are archived. [Harness instructions](../../../tools/pow-bench/README.md) describe
`moon run pow-bench:matched` and summary regeneration.

- Host: Apple M5 Max, 18 logical CPUs, 36 GiB RAM, Darwin 27.2 arm64. One fast
  desktop, with no thermal/host-load isolation; no competing benchmark was run.
- Go 1.26.9, x/crypto 0.54.0, ALTCHA Go 2.4.1; Node 24.22.0, ALTCHA JS 2.8.0,
  hash-wasm 4.12.0, Playwright 1.64.1, esbuild 0.28.1. The workspace uses caret
  ranges; these are the actual benchmark versions, not a claim about future installs.
- Chromium 156.0.8078.4 and Playwright WebKit 27.2, headless. WebKit is not a
  shipping Safari/iPhone measurement. Firefox failed before launch with
  `Could not find profile folder`; its error is archived, not counted as a pass.
- Sixteen profiles, 32 paired puzzles per profile. Both implementations receive
  identical salt, nonce, hidden counter and prefix, and must produce the same key.
  Go uses crypto/pbkdf2 or x/crypto/argon2 in both paths. Browsers use WebCrypto
  PBKDF2 or the same hash-wasm Argon2id adapter; ALTCHA's extension API supplies it.
- All profiles precompute one 32-byte key at issuance, publish a 16-byte prefix,
  and authenticate the full key for KDF-free verification. Salt/nonce are 16 bytes;
  password input is nonce followed by big-endian uint32. Counter ranges are finite.
- PBKDF2 has 5,000 iterations and N = 512/1,024/2,048/4,096. Argon2id v1.3 has
  one pass, one lane, and fixed memory per family: 4 MiB with N = 32/64/128/256;
  16 MiB with N = 8/16/32/64; 64 MiB with N = 2/4/8/16. All KDF outputs are 32 bytes.
- One shared set of random uniform quantiles determines counter positions across
  families and levels. Each challenge still has fresh salt/nonce. Own/library
  execution order alternates by sample. Browsers and profiles run sequentially;
  each implementation has its own worker and an excluded cold first solve.
- Timings are nearest-rank p50/p95. At n=32, p99 is the maximum; complete tables
  retain it without claiming a stable tail estimate. Paired median ratios compare
  each puzzle, rather than dividing independently sampled percentiles.
- Server metrics are the median of three batch means, alternating implementation
  order, with 20 warm-ups per batch. Issuance batches contain 100 PBKDF2 or 16
  Argon2 calls; verification batches contain 1,000 calls. Decode includes strict
  stored-challenge parsing; proof parsing, key lookup, DB, guards and HTTP are excluded.
- Memory probes use separate Go processes, concurrency 1/4/8, synchronized starts
  and three issuances per worker. Heap is sampled every 200 microseconds; Darwin
  max RSS includes runtime and retained/GC memory. These are observations, not bounds.

The corrected memory tracker retains WASM memories only within a single KDF call.
A discarded four-sample pilot exposed accidental retention across calls; none
of that pilot's measurements appear in the archived full run. The final run's
worker bundle contains both implementations and all KDFs (34,078 minified bytes),
so it is not a production PBKDF2 asset-size measurement.

## Same algorithm, different owner

Level 1 solve times below are p50 / p95 in milliseconds. The full tables include
all four levels for every family and both implementations.

| Family / implementation | Maximum trials | Go | Chromium | WebKit |
|---|---:|---:|---:|---:|
| PBKDF2 5,000 / own | 512 | 92.35 / 190.50 | 70.60 / 146.20 | 127.00 / 269.00 |
| PBKDF2 5,000 / altcha | 512 | 92.74 / 191.18 | 70.70 / 146.20 | 135.00 / 275.00 |
| Argon2id 4 MiB / own | 32 | 22.34 / 45.99 | 29.00 / 59.10 | 41.00 / 83.00 |
| Argon2id 4 MiB / altcha | 32 | 22.27 / 46.15 | 25.80 / 58.10 | 42.00 / 84.00 |
| Argon2id 16 MiB / own | 8 | 22.97 / 45.95 | 27.60 / 58.10 | 32.00 / 64.00 |
| Argon2id 16 MiB / altcha | 8 | 22.93 / 46.01 | 27.80 / 54.50 | 33.00 / 64.00 |
| Argon2id 64 MiB / own | 2 | 26.33 / 51.24 | 31.50 / 62.50 | 32.00 / 63.00 |
| Argon2id 64 MiB / altcha | 2 | 25.31 / 50.94 | 34.00 / 63.80 | 32.00 / 63.00 |

Across the sixteen profiles, paired median own/ALTCHA solve ratios were
0.996–1.001 in Go, 0.979–1.005 in Chromium and 0.991–1.002 in WebKit.
There is no substantial solve-time advantage from protocol ownership here.
Own PBKDF2's paired browser/Go ratio was about 0.77 in Chromium and 1.40 in WebKit;
these implementations are not optimized attacker or GPU baselines.

Level 1 server costs, microseconds per operation:

| Family / implementation | Issue | Verify | Reject bad work | Decode + verify |
|---|---:|---:|---:|---:|
| PBKDF2 5,000 / own | 398.41 | 1.64 | 1.67 | 10.24 |
| PBKDF2 5,000 / altcha | 411.32 | 16.92 | 16.85 | 32.33 |
| Argon2id 4 MiB / own | 1489.80 | 1.84 | 1.74 | 10.15 |
| Argon2id 4 MiB / altcha | 1505.56 | 17.50 | 17.35 | 33.43 |
| Argon2id 16 MiB / own | 5785.04 | 1.96 | 1.84 | 10.52 |
| Argon2id 16 MiB / altcha | 5810.85 | 18.77 | 18.08 | 34.80 |
| Argon2id 64 MiB / own | 25101.86 | 1.87 | 1.82 | 10.85 |
| Argon2id 64 MiB / altcha | 25512.20 | 19.02 | 18.69 | 35.34 |

Our PBKDF2 verifier is about 10× cheaper in this narrow microbenchmark, or about
3× including stored-challenge decoding. That is not a 10× faster product API:
DB admission and production bindings are absent. The difference includes ALTCHA's
generic canonical serialization and the adapter's scope validation. Our fixture
uses typed scope and two domain-separated HMACs. Both enforce scope and fixed
profiles. Invalid work invokes no KDF in either verifier.

Own PBKDF2 issuance stays 397–398 microseconds across all four levels. The search
curve therefore adds client work without increasing the issuer's per-challenge
KDF. Verification stays around 1.6–1.8 microseconds. Issuance still needs limits:
an attacker can request/abandon puzzles or grind for an early counter.

## Increasing cost and the first ten attempts

The policy example is ten PoW-free checks, then one level per five checks, capped
at four. It is not a shipping default. Work is approximate expected search cost,
not a guaranteed delay; a lucky first counter can solve any level quickly.
The following table is the selected own PBKDF2 path; ALTCHA's corresponding
p95 values are 146/294/588/1,191 ms in Chromium and 275/532/1,075/2,168 ms in WebKit.

| Prospective check ordinal | Effective level | Maximum trials | Expected trials | Chromium p50 / p95 ms | WebKit p50 / p95 ms |
|---|---:|---:|---:|---:|---:|
| 1–10 | 0 | No puzzle | No puzzle | — | — |
| 11–15 | 1 | 512 | 256.5 | 70.60 / 146.20 | 127.00 / 269.00 |
| 16–20 | 2 | 1,024 | 512.5 | 141.90 / 294.00 | 260.00 / 532.00 |
| 21–25 | 3 | 2,048 | 1,024.5 | 284.50 / 587.10 | 512.00 / 1068.00 |
| 26 onward, below hard limit | 4 | 4,096 | 2,048.5 | 568.70 / 1188.30 | 1067.00 / 2168.00 |

CEL returns an integer level from trusted server accounting. Go maps it to the
immutable profile table; it never evaluates a client-selected exponent, cost or
memory amount. [The worked policy](bot-protection-plan.md#progressive-work-allocation-through-cel)
records the expression, settings and boundary behavior. Zero-work slots still
require atomic execution reservations; 100 concurrent requests cannot all see
the first free check. At proof submission, current price and hard guards are
rechecked before consuming evidence and reserving the protected operation.

The 64 MiB Argon2 family illustrates an important limit: doubling N from 2 to 4
increases expected trials from 1.5 to 2.5, not 2×. Doubling a small search bound
is not exact exponential expected cost. Expected solver/issuer KDF counts at
level 1 are 256.5:1 for PBKDF2, 16.5:1 for Argon2 4 MiB, 4.5:1 for 16 MiB and
1.5:1 for 64 MiB. These are evaluations of different KDFs, not a security ranking.
Larger Argon2 searches can restore asymmetry but also increase client work.

## Argon2's memory and issuance tradeoff

Argon2 base issuance costs about 3.7× / 14.5× / 63× the selected PBKDF2 path at
4 / 16 / 64 MiB. Go allocates roughly that configured memory per issuance, versus
about 4 KiB for own PBKDF2. Concurrent and retained allocations raise process RSS:

| Family | Own issuer max RSS MiB at 1 / 4 / 8 workers | ALTCHA max RSS MiB at 1 / 4 / 8 workers | Browser linear memory per KDF MiB |
|---|---:|---:|---:|
| PBKDF2 5,000 | 11.08 / 11.50 / 12.08 | 11.14 / 11.78 / 12.59 | 0.00 |
| Argon2id 4 MiB | 23.73 / 52.50 / 77.66 | 23.86 / 45.16 / 81.84 | 4.44 |
| Argon2id 16 MiB | 43.69 / 141.19 / 270.42 | 44.06 / 142.28 / 302.48 | 16.44 |
| Argon2id 64 MiB | 139.88 / 525.56 / 1102.55 | 141.25 / 526.14 / 1038.89 | 64.44 |

The 64 MiB candidate reached roughly 1.0–1.1 GiB RSS at eight concurrent issuers.
That includes three calls per worker and GC retention; it is not a claim that one
64 MiB invocation inherently needs 128 MiB. Both implementations show the same
memory pressure. The browser column is the largest sum of WASM linear memories
created within one derivation, not total browser memory. It neither includes nor
bounds accumulated GC retention, JS heaps, native crypto or process overhead.

Both engines required a WASM CSP allowance for the hash-wasm path: the same-origin
worker ran with `script-src 'self' 'wasm-unsafe-eval'`, and the no-WASM-allowance
probe failed as expected. The PBKDF2 path uses WebCrypto and needs no WASM; the
original smoke test runs under same-origin script/worker CSP without unsafe-eval.
Do not silently switch algorithms when a required worker or WASM execution fails.

Argon2 is designed to impose memory cost, but this run does not measure optimized
GPU throughput, parallel attacker hardware, energy or cost per admitted abuse
operation. Its low-memory, one-pass profiles need separate security analysis;
merely choosing the Argon2id name does not establish sufficient attacker cost.
A separately registered family is possible after that evidence and mobile/load
validation. It is not initially enabled; compatible framing may retain v1, while
incompatible proof semantics require a new protocol version.

## Final protocol and remaining implementation

[ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md) specifies `zitadel_pow_v1`,
four immutable `pbkdf2_sha256_5000_l1` through `_l4` profiles, exact KDF bytes,
separate parameter/solution HMAC domains and stored context binding. Public gates
carry protocol, challenge ID, profile ID, salt, nonce, key prefix and expiry in
snake_case. The proof contains protocol, challenge ID and full derived key.
There is no client-selected algorithm, counter proof or opaque ALTCHA blob.

The measured fixture labels are `zitadel_kdf_candidate_v1` and `pbkdf2_5000_lN`;
ADR 019 fixes product names and adds deployment/release, key-version and operation
bindings. Fixture keys are public, expiry is 24 hours for reproducibility, and
the corpus publishes counters/solutions. None of these are product behaviors.
The product lifetime remains five minutes and its foreground budget five seconds;
the benchmark used a 30-second diagnostic budget, with zero observed timeouts.

The run completed **1,024 native solves and 2,048 browser proofs**, all paired
keys matching and all browser proofs accepted by the corresponding Go verifier.
Largest observed 10 ms main-thread timer intervals were 12.9 ms in Chromium and
16 ms in WebKit. These are responsiveness observations, not mobile UX guarantees.
Cold-solve/worker-start values are retained in the full tables. The focused checks
also pass Go tests/vet, both decoder fuzzers, Chromium/WebKit vector/CSP/cancel
smoke checks, benchmark lint, task-graph validation and the 85-record ADR index.
The cancellation smoke checks are harness-level and do not measure the instant
all native crypto activity stops after terminating a worker.

Stage 1 closes ownership, primitive, framing and profile selection for implementation.
It does **not** implement gates, CEL outputs, admission storage or cloud wiring.
Before production: review the full binding implementation and permanent vectors;
measure shipping Firefox/Safari and real Android/iOS including a slow device;
validate key rotation/revocation and concurrent one-use consumption on Postgres,
SQLite and Spanner; load-test issuance, abandoned challenges, free-slot accounting
and proof verification with real DB/HTTP costs; measure cloud receipt exchange and
BotID fallback. Deployments enable only calibrated levels. Agents can pay PoW;
quotas, hard limits and authenticated automation remain necessary.

## Primary sources

- [ALTCHA Go v2.4.1](https://github.com/altcha-org/altcha-lib-go/blob/v2.4.1/v2/altcha.go): local construction, full-key verification and solver behavior.
- [ALTCHA algorithm adapters](https://github.com/altcha-org/altcha-lib/blob/main/docs/algorithms.md): WebCrypto PBKDF2 and custom Argon2 adapters.
- [hash-wasm](https://github.com/Daninet/hash-wasm): MIT-licensed WASM implementation used by both browser Argon2 paths.
- [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html): Argon2 specification and memory/time tradeoff analysis; not performance evidence for our chosen profiles.
