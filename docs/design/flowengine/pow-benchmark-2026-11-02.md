# Internal PoW benchmark — 2026-11-02

> **Status:** Stage 1 desktop spike complete; production calibration remains open.
> **Interpretation:** Original comparison; selection is resolved by the [matched follow-up](pow-matched-benchmark-2026-11-02.md).
> **Contract:** [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md).

## What the measurements change

The earlier plan favored our own leading-zero SHA-256 puzzle. It wins on server
issuance cost, but this implementation makes ordinary browsers pay substantially
more than a native client. ALTCHA's precomputed PBKDF2 profile is the better first
candidate for operation admission: bounded search, inexpensive verification, and
much less browser/native disparity on this machine. However, this compares both
different algorithms and different implementations. The earlier recommendation
to select ALTCHA was premature: an equivalent own PBKDF2 implementation and
Argon2id had to be compared before deciding. The [matched follow-up](pow-matched-benchmark-2026-11-02.md)
now supplies that comparison and selects own PBKDF2 for v1. These original
measurements are unchanged.
ZITADEL still owns issuance,
keys, context binding, replay prevention and admission. **No ALTCHA server,
Sentinel, hosted verification or provider account is involved.**

PoW remains useful when agents can complete visual challenges: it charges for
attempts without pretending to identify a human. It is not the only useful control.
Per-principal/account/project budgets, send quotas, authenticated automation,
passkeys and service-side abuse controls remain necessary. A sufficiently funded
agent can pay the work; solving PoW grants neither identity nor permission.

## Method

- Apple M5 Max, ARM64, 18 logical CPUs, 36 GiB RAM, Darwin 27.2.0. This is a fast
  desktop, not a low-end baseline. Host activity/thermal behavior were not isolated.
- Go 1.26.9; ALTCHA Go v2.4.1; go-jose 4.1.6; Node 24.22.0; ALTCHA JS 2.8.0;
  noble/hashes 2.4.0; Playwright 1.64.1; esbuild 0.28.1.
- Headless Chromium 156.0.8078.4 and Playwright WebKit 27.2. WebKit is not a
  measurement of shipping Safari or an iPhone. Firefox 157 / Playwright build
  1555 failed before launch with `Could not find profile folder`, with both
  temporary and explicit workspace profiles. No Firefox result is claimed.
- 32 independently issued challenges per configuration. Each exact challenge is
  solved in Go and both browsers. Cross-candidate challenges are independent, so
  quantiles also reflect random search luck; comparisons are exploratory.
- One browser worker, sequential engines/candidates, excluded first warm-up.
  Our worker uses noble SHA-256; ALTCHA SHA is measured both with a noble adapter
  through its public `deriveKey` extension and its stock WebCrypto adapter. The
  stock SHA sample is only eight 16-bit challenges; no stock 20-bit result is
  extrapolated. PBKDF2 uses ALTCHA's stock WebCrypto adapter.
- Native Go uses each implementation's solver, including ALTCHA's allocation,
  timeout and loop overhead. This is **not an optimized adversary**, GPU/ASIC,
  multicore, WASM or energy benchmark. Native/browser ratios compare these
  implementations, not intrinsic algorithm hardness.
- Server operations: 20 warm-ups then 1,000 serial operations, elapsed ns/op and
  allocation deltas. Scope/config validation is included; decode is reported
  separately. No database, network, key lookup/rotation or admission transaction
  is measured. Scope is a synthetic project/attempt/operation/requirement/generation.
- Repeated invalid-work and invalid-signature calls measure verifier costs,
  **not** concurrent HTTP flood capacity. Challenge expiry is 24 hours only to
  finish the experiment; the product profile uses five minutes.

The [harness](../../../tools/pow-bench/README.md),
[raw challenge/native data](../../../tools/pow-bench/results/2026-11-02-macos-arm64/corpus.json),
[browser proofs/times](../../../tools/pow-bench/results/2026-11-02-macos-arm64/browser-results.json)
and [full generated tables](../../../tools/pow-bench/results/2026-11-02-macos-arm64/summary.md)
are included in this change. Base checkout: `f227766552041a7e7c072a26ae4cc90ccca1fb37`.

## Results

Observed nearest-rank p50 / p95, in milliseconds. With 32 samples, p99 is the
maximum and cannot establish a population tail; the raw report includes it.

| Configuration | Native Go | Chromium worker | WebKit worker |
|---|---:|---:|---:|
| Own SHA-256, 16 bits | 1.95 / 10.40 | 51.80 / 260.20 | 19 / 96 |
| Own SHA-256, 18 bits | 6.55 / 29.42 | 156.50 / 693.20 | 73 / 326 |
| Own SHA-256, 20 bits | 27.50 / 92.16 | 645.10 / 2207.90 | 303 / 1039 |
| ALTCHA SHA-256, 20 bits, noble adapter | 33.75 / 149.29 | 733.10 / 3394.60 | 558 / 2546 |
| ALTCHA PBKDF2, 1,000 iterations, 8-bit prefix | 9.77 / 36.98 | 8.30 / 31.40 | 15 / 63 |
| ALTCHA PBKDF2, 5,000 iterations, 8-bit prefix | 51.77 / 177.30 | 39.70 / 134.80 | 72 / 252 |
| ALTCHA PBKDF2, 5,000 iterations, hidden counter 0–511 | 78.00 / 199.94 | 59.40 / 151.00 | 107 / 272 |

The last row exposes the first 16 bytes of a 32-byte derived key and a keyed
authenticator of the full key. The client searches for the hidden counter; the
server can validate the full derived key using the authenticator without another
PBKDF2. The counter itself is not verified by that fast path and is not evidence.

Our SHA worker took a median paired 23–24 times the native Go time in Chromium,
and 9–11 times in WebKit. The precomputed PBKDF2 worker took 0.8 times in Chromium
and 1.4 times in WebKit. That supports this implementation choice; it does not
show that PBKDF2 removes GPU, native optimization or parallelism advantages.

Server costs, microseconds per operation:

| Configuration | Issue | Verify valid | Verify bad work | Decode + verify |
|---|---:|---:|---:|---:|
| Own SHA-256, 18 bits, JWE ticket | 3.11 | 10.93 | 10.82 | 16.05 |
| ALTCHA SHA-256, 20 bits | 9.44 | 14.22 | 14.51 | 26.07 |
| ALTCHA PBKDF2, 5,000, prefix search | 9.69 | 412.35 | 411.86 | 424.91 |
| ALTCHA PBKDF2, 5,000, precomputed | 408.80 | 16.14 | 16.24 | 29.10 |

Precomputation moves work to **issuance**, about 132 times our SHA issuance cost.
It makes bad proofs cheap to reject, but unrestricted challenge generation would
be an attack surface. Increasing PBKDF2 iterations would increase issuance cost;
v1 therefore fixes iterations and leaves only a bounded counter range for future
calibration. Reuse pending challenges; reserve issuance capacity before deriving
keys; constrain repeated flow/attempt creation and refresh. These are prerequisites.

The combined research worker is 10,050 minified bytes, including all candidates;
this is not the final login asset size. First challenge/proof payloads were
549/20 bytes for own SHA-18 and 539/106 for ALTCHA precomputed. These are raw
benchmark objects; the then-proposed opaque wrapper would add base64 overhead,
and product metadata/transport are not included. The matched follow-up replaces
that proposal with a ZITADEL-owned public projection. The maximum observed 10 ms
main-thread timer interval was 12.4 ms in Chromium and 18 ms in WebKit. Worker
startup was 2.8/8 ms. Termination calls returned below timer resolution; this does
not measure the time until all native crypto work has stopped.

All **528 browser proofs** verified in Go. Own digest framing matched Go in both
engines, including a counter beyond JavaScript's safe integer range. CSP used
same-origin scripts/workers and no inline script, blob worker or external fetch.

## Candidate profile and remaining gates

[ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md) records the internal
admission design and now-selected own protocol. This original run measured the
ALTCHA candidate: PBKDF2/SHA-256, 5,000 iterations, 32-byte key, 16-byte
prefix, counter uniformly chosen from 0–511, HMAC-authenticated parameters and
full-key proof, scope-bound persistent single-use admission. No browser `time`
or submitted counter determines validity. The pure SHA prototype remains a
comparison, not a second fallback that silently weakens the same requirement.

Five-minute validity, one worker and a five-second foreground solve budget are
initial engineering limits, **not mobile results**. The matched follow-up defines
the immutable four-level v1 profile table; production activation and ceilings
remain uncalibrated. Do not promise a production p95 until
Firefox, shipping Safari, real Android/iOS and a slow-device baseline are tested.
Targets remain p95 below one second on typical devices and three seconds on the
chosen slower device. A timeout offers an explicit retry/permitted alternative;
it does not automatically refresh challenges or waive admission.

Concurrent replay, restarts, key rotation, DB writes, precomputation cancellation
under load, issuance saturation, abandoned attempts, backend exchange latency
and BotID fallback are stage 2–7 integration measurements. The benchmark has no
database or deployed gateway, so it cannot claim those properties. Argon2id is now measured in the matched follow-up. Scrypt, GPU solvers, optimized
WASM SHA and multiple hardware classes remain unmeasured.

## Primary references

- [ALTCHA Go v2.4.1 source](https://github.com/altcha-org/altcha-lib-go/blob/v2.4.1/v2/altcha.go): local issuance, full-key signature fast verification and counter behavior.
- [Go v2.4.1 module](https://github.com/altcha-org/altcha-lib-go/blob/v2.4.1/v2/go.mod): retracts v2.0.0–v2.3.0 for accepting unverified proofs under incomplete configuration.
- [ALTCHA library](https://github.com/altcha-org/altcha-lib): browser KDF adapters and extension points; versions used above are archived in the result metadata/documentation.
- [ALTCHA integration security guidance](https://altcha.org/docs/integration/security-recommendations/): host responsibility for replay and endpoint protection.
- [Anubis PoW rationale](https://github.com/TecharoHQ/anubis/blob/main/docs/docs/design/why-proof-of-work.mdx): another SHA-based construction, not performance evidence for this implementation.
