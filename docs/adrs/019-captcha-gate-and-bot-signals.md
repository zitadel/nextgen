# ADR 019: Captcha Gate Contract & Bot-Detection Signals

> **Status:** Proposed
> **Date:** 2026-05-26
> **Amended:** 2026-11-02 after the internal PoW comparison.
> **Context:** Flow gates, operation admission, customer bot protection and cloud signals.

## Decision

ZITADEL owns bot-protection issuance, verification, keys, persistence and admission.
The turnkey implementation runs inside the Go server and a first-party browser
worker, with **no ALTCHA server, Sentinel, hosted service, Redis or customer
provider account**. Customers can bring challenge-provider keys or evidence from
a backend they trust.

The [matched stage 1 benchmark](../design/flowengine/pow-matched-benchmark-2026-11-02.md)
compares ZITADEL-owned PBKDF2 and Argon2id protocol/solver code against ALTCHA
using identical puzzles and four increasing search ranges. Select **ZITADEL-owned
precomputed PBKDF2-HMAC-SHA-256 as the initial default**, using Go's standard
library and browser WebCrypto. ALTCHA stays a research/reference dependency; it is not the product
protocol or runtime dependency. Own the small protocol and admission adapter,
not a new cryptographic primitive.

Matched solve times provide no material performance reason to depend on ALTCHA;
our narrower verifier also has lower measured overhead. Argon2id works in Go and
browser WASM, but raises issuer CPU/memory cost, needs a WASM CSP allowance and
has not established an attacker-cost benefit on GPUs or slower devices here.
Keep it as a measured candidate for a later supported algorithm family; it is
not enabled by the initial profile table. Implement the registry/configuration
boundary now so projects can change to a qualified algorithm in a later release.
This decides ownership and protocol; production activation and calibration still
require the device, security-review and admission-load gates below.

Progressive work allocation is part of the admission design independently of the
primitive. CEL requests a bounded work level from trusted attempt accounting;
the server maps it to calibrated profiles, preserves hard guards and consumes
admission once. A PoW-free band followed by capped exponential work is supported
in the design, not yet in the runtime.

PoW prices an operation; it proves neither humanity nor identity. Agents can pay
it. Keep ADR 078's hard guards, quotas and volume limits regardless of a solved
challenge or a clean vendor verdict. Legitimate automation uses authenticated
API operations and their applicable limits, not a spoofable User-Agent exemption.

This ADR specifies the implementation contract. It does not claim the feature is
shipped: the flow runtime currently emits empty gates and rejects nonempty
`gate_proofs`; the existing auth-attempt verifier returns authentication factors.
The pure [PoW core](../../internal/crypto/pow/doc.go) now implements the four
PBKDF2 profiles, issuance, bounded verification and
[permanent WebCrypto/Go byte vectors](../design/flowengine/testdata/README.md).
It grants no admission and exposes no endpoint; persistent one-use consumption
and shared operation enforcement remain pending.
The [implementation plan](../design/flowengine/bot-protection-implementation.md) sequences
that missing work. Production calibration remains gated on real-device results.

## One admission service, three evidence sources

| Source | Client/backend work | ZITADEL's responsibility |
|---|---|---|
| Built-in `zitadel_pow` | First-party worker or native client derives a key | Issue locally, verify locally, bind and consume admission |
| Customer challenge provider | Widget obtains Turnstile/hCaptcha/reCAPTCHA token | Verify with configured adapter and server-held secret; check expected action/host where supported |
| Customer backend | Backend verifies BotID, an edge verdict or its own system | Authenticate that backend, validate its scope, issue a bound receipt; treat it as a trusted assertion |

Evidence alternatives for one requirement compose with OR **only when configured**;
separate required gates compose with AND. A hard guard refusal wins over all of
these. A customer's backend assertion is not independent verification by ZITADEL
that a vendor was called. Missing, forged or unavailable evidence is never clean.

## Built-in profile: `zitadel_pow_v1`

### Selected construction and immutable profiles

| Parameter | v1 contract |
|---|---|
| Initial default algorithm | PBKDF2-HMAC-SHA-256 (`pbkdf2_sha256`) |
| Iterations per trial | 5,000, fixed at every level |
| Salt / nonce | Independent 16-byte CSPRNG values |
| KDF password bytes | Raw nonce bytes followed by the unsigned counter as four big-endian bytes |
| Derived key | 32 bytes |
| Public derived-key prefix | First 16 bytes, never the entire key |
| Hidden counter | Uniform integer in `[0, N-1]`; use unbiased sampling |
| Authenticators | Two independent HMAC-SHA-256 keys; framing below |
| Validity | Five minutes; server time and stored requirement expiry are authoritative |
| Browser work | One worker; bounded trials and a five-second foreground budget |

| `profile_id` | Level | N (maximum trials) | Expected trials `(N+1)/2` |
|---|---:|---:|---:|
| `pbkdf2_sha256_5000_l1` | 1 | 512 | 256.5 |
| `pbkdf2_sha256_5000_l2` | 2 | 1,024 | 512.5 |
| `pbkdf2_sha256_5000_l3` | 3 | 2,048 | 1,024.5 |
| `pbkdf2_sha256_5000_l4` | 4 | 4,096 | 2,048.5 |

Level zero issues no puzzle. These are the measured profile definitions for
implementation/preview, not enabled production thresholds. Increasing the search
range approximates doubling expected work without changing server KDF cost.
Individual solve times vary with the hidden counter; there is no minimum-work
or duration guarantee. Select an allowed subset at deployment; do not change a
profile's meaning after publication. The initial implementation accepts only
these PBKDF2 profiles. A later supported algorithm gets new immutable profiles;
compatible KDFs can share the envelope/construction version. Incompatible input
framing, output/proof semantics or binding requires a new protocol version.
CEL and clients never supply raw KDF parameters.

Issuance evaluates the KDF once at the hidden counter, publishes only its first
half and stores authenticators for its full key and context. Discard the counter
and full key after issuance. The client searches from zero up to `N-1`, comparing
the first half, and returns the full key. Verification checks authenticators and
scope without evaluating PBKDF2, including for invalid proofs. No missing-field
fallback may turn verification into KDF work. Neither a counter nor reported
solve time is accepted as evidence.

PBKDF2 is not memory-hard; specialized hardware can still have advantages. The
Argon2id experiment does not prove GPU resistance or equal security between
profiles. Never silently replace required work with an easier algorithm. An
explicitly permitted external evidence alternative is a separate policy choice.

### Binding, authenticators and public wire representation

Persist one immutable context `C` as compact UTF-8 JSON with exact snake_case
fields: `protocol`, `profile_id`, `project_id`, `deployment_id`, `release_id`,
`policy_revision`, `config_revision`, `attempt_id`, `operation`,
`operation_instance_id`, `requirement_id`, `challenge_id`, `generation`,
`challenge_key_version`, `solution_key_version`, `expires_at`, `salt`, and `nonce`.
Revision identifiers may be null only when that policy/config resource is absent;
all required bindings must be resolved before issuance. Expiry is integer Unix
seconds internally. The operation instance pins its target and immutable operation
metadata in server state; changing protected input needs a new operation instance.
Never persist a plaintext password or expose identifying inputs in challenge data.
Generation starts at one. Required binding strings are nonempty valid UTF-8 and
at most 256 bytes; their storage/resource schemas can impose tighter validation.

Serialize `C` once on the server and retain its exact bytes. With raw 32-byte
solution `K`, use the following framing (`||` is byte concatenation; literal
prefixes are ASCII):

```text
key_mac = HMAC-SHA-256(solution_key, "zitadel:pow:solution:1:" || C || K)
B = UTF8_JSON({"context": C, "key_prefix": hex(K[0:16]), "key_mac": hex(key_mac)})
mac = HMAC-SHA-256(challenge_key, "zitadel:pow:parameters:1:" || B)
```

Here `context` embeds the stored JSON object bytes, not a quoted string. Preserve
`B` exactly too; verify its MAC before treating it as authenticated data. No
client must reproduce a canonical JSON serializer. Load key versions from the
requirement, authenticate the stored bytes, strictly parse and match every binding
to authoritative state, then verify the solution MAC and prefix. Compare MACs in
constant time. Keys and MACs stay server-side; the browser needs only the public
projection below. Authenticated bytes alone never override expiry, revocation,
current guard decisions or one-use consumption. The benchmark uses the same
construction with a smaller fixture context; production binding and persistence
costs remain unmeasured.

Runtime gate and proof maps remain keyed by **gate name**, not gate kind
([ADR 021](021-ordered-arrays-for-step-fields-actions-gates.md)):

```json
{
  "gates": {
    "bot_check": {
      "kind": "captcha",
      "provider": "zitadel_pow",
      "config": {
        "protocol": "zitadel_pow_v1",
        "challenge_id": "<storage-generated-id>",
        "profile_id": "pbkdf2_sha256_5000_l1",
        "salt": "<32 lowercase hex characters>",
        "nonce": "<32 lowercase hex characters>",
        "key_prefix": "<32 lowercase hex characters>",
        "expires_at": "2026-11-02T15:05:00Z"
      }
    }
  }
}
```

All public fields are ZITADEL-owned snake_case; there is no opaque ALTCHA payload.
The worker validates exact lengths, the supported profile and deadline before
starting bounded work. It never loads code or a URL from challenge data. The
profile fixes the trial bound, so there is no second client-controlled range.
Public projections carry no authorization; the stored challenge is authoritative.

`gate_proofs.bot_check` remains a string: the strict JSON serialization of
`{"protocol":"zitadel_pow_v1","challenge_id":"…","derived_key":"<64 lowercase hex characters>"}`.
The server loads its challenge; clients never echo or override its parameters.
Enforce a 2 KiB proof-string limit, exact case-sensitive fields/types, no duplicate
keys, nulls or trailing data; limit the stored challenge body to 4 KiB. Reject
unknown versions, profiles and providers. Resource IDs follow
[ADR 047](047-dialect-id-generation.md); random puzzle nonces are not resource IDs.

### Lifecycle and resource limits

Persist requirements separately from `AuthFactor`:

```text
pending -> satisfied -> consumed
           (expiry, supersession and hard guards can still refuse admission)
```

A read/render returns the existing unexpired pending challenge. It does not run
PBKDF2 or create another row. Reserve bounded issuance capacity before deriving a
new challenge; derive outside retryable database transactions and publish with a
conditional generation check. Concurrent contenders have one authoritative
challenge; limit wasted precomputation too. Allow one active challenge per gate
and operation instance, initially at most four live gates per attempt. These
are conservative engineering caps, not capacity results from the microbenchmark.

No refresh on every failed proof or automatic timeout loop. A refresh supersedes
the previous generation and spends issuance budget. Expired challenges need an
explicit retry subject to the same limits. Bound new attempts, outstanding
requirements, refreshes, proof bytes, verification concurrency and key lookups.
Use ADR 078's edge budgets and service admission limits; do not add a database
write for each rejected request. Garbage-collect expired/abandoned state.

Before password hashing, user creation, code sending or another protected side
effect, atomically check and consume **all** required admissions and recheck hard
guards. One success authorizes one operation attempt, including a failed password
check. Retries with the same idempotency/operation instance recover status; they
never run a second protected attempt for the same spent proof. New input or target
that changes the protected operation needs fresh admission. Preserve the bound
operation across a crash, and fail closed if consumption cannot be established.

Verify evidence before a short transaction; consume with a compare-and-set in
shared storage. Process-local caches, flow cookies and provider one-use tokens
cannot provide cross-replica replay prevention. Implement/test the same semantics
on Postgres, SQLite and Spanner. Full database/HTTP load tests remain stage 2 work.

## Flow and direct API enforcement

The operation service owns admission. The flow engine presents requirements and
collects proof strings; editing templates, omitting `gate_proofs`, changing flow
paths or calling the service directly cannot skip required evidence.

Keep `captcha` as the sole gate kind. Surface gates in domain/runtime/API
projection; add `<zl-captcha>` and the mandatory-consumer patcher. A first-party
same-origin worker runs independently of the UI thread. Cancel it on navigation
or supersession; show accessible working/timeout/retry states. A blocked worker
or a slow device does not silently pass. External widget tokens use separate
provider adapters and only their public settings reach the browser.

Auth-attempt issue/verify endpoints may delegate a `captcha` ceremony to this
service, so custom clients have the same requirements. **Do not reuse the existing
factor-success transition unchanged.** CAPTCHA must never add a factor, complete
an auth attempt, raise ACR/assurance, or become reusable session clearance.

Operation templates initially cover self-service signup (`user.create`) and
password checks (`auth.check`), before expensive preparation/verification. Code
send/recovery endpoints require their send quotas and admission when introduced.
Registration by passkey or SSO still reaches the signup guard. Authorized operator
provisioning uses its distinct operation context, not a browser-selectable bypass.
Pre-flow allocation defense is separate from a gate that needs an existing attempt.

## Configuration and policies

Add a revisioned `bot_protection` configuration resource, resolved from the same
pinned deployment as the flow/policy. It selects allowed evidence, named provider
connections, trusted backend sources and explicit fallback rules. Public site
keys may be projected; secrets are references resolved server-side from the
project secret infrastructure. Provider connections and source lists are not
CEL settings or untyped JSON stuffed into today's boolean/integer policy schema.

[ADR 066](066-operation-policies.md) remains the decision layer: an operation
policy may require evidence and tighten guards. Introduce its `require` result,
undisclosed rule support, a typed integer `pow_level` output and audit mode with
that consumer. The current allow/deny
password-setting consumer does not already provide them. No instance means no
project policy, not disabled server guards. A release validates all selected
connections/fallbacks; rollback cannot revive revoked keys or consumed evidence.

### Algorithm configuration and evolution

A built-in provider has `kind: zitadel_pow` and `algorithm: pbkdf2_sha256` by
default. The revisioned bot configuration, rather than the password-hashing
policy or CEL, selects this algorithm. Initially the allowed project value is
only `pbkdf2_sha256`; a future release can add `argon2id` after qualification.
Persist/materialize the default in the canonical configuration revision. When
no resource exists, the v1 built-in default remains PBKDF2 and each requirement
pins the resolved profile; a binary upgrade cannot silently change that choice.

The operator's enabled algorithms/profiles constrain project choices. Unsupported
or disabled values fail configuration/deployment validation; do not substitute
a different algorithm. The registry fixes the algorithm, KDF parameters, input/
output framing, work level and trial bound for every `profile_id`. That identifier
is authenticated and matched to stored state, so clients need no second algorithm
selector in their proof. No public configuration supplies code, a remote solver
URL, arbitrary parameters or an unregistered algorithm.

CEL requests a level within the resolved family. Work levels across algorithm
families are not comparable evidence: Argon2 level two cannot automatically
satisfy PBKDF2 level two. Apply guard floors for the selected, operator-approved
family and reject a configuration that cannot meet them. Verify the exact issued
profile/requirement/generation before considering whether its level satisfies the
current price. Never reinterpret or upgrade a proof into another family.

Ordinary algorithm changes take effect through a new configuration revision and
deployment. Existing requirements remain pinned to their original revision and
profile for their short lifetime; they are not rehashed. Preserve compatible
verification support through that lifetime. Registry status distinguishes
`enabled` (issue and verify), `verify_only` (drain issued work; no fresh issuance)
and `disabled` (reject immediately, including pending work). A pinned deployment
that can no longer issue its selected profile must move to a supported deployment
or fail with an actionable unavailable result. Rollback cannot revive revoked
profiles or keys, or switch a live challenge's algorithm. Mutable availability is
separate from immutable parameters; authoritative shared revocation and cache
invalidation must prevent a stale replica from admitting disabled profiles.

Ship matching server registry and browser/SDK support before enabling a new family.
Mixed-replica and rollback validation must retain every profile still needed by
live requirements/deployments. An unsupported browser/client reports an explicit
unsupported result; claimed client capabilities are not permission to choose
cheaper work. Only an explicitly configured evidence alternative may satisfy the
requirement. The [implementation plan](../design/flowengine/bot-protection-implementation.md)
contains the rollout sequence and Passwap assessment.

### Progressive work and protected accounting

A policy can request a PoW-free allowance and then increasing work, for example
ten checks followed by doubling every five checks up to a fixed ceiling. These
are illustrative parameters, not shipping defaults. ADR 066 defines the typed
CEL output; ADR 078 owns trusted event/window counts and atomic in-flight
execution reservations. The [worked plan](../design/flowengine/bot-protection-plan.md#progressive-work-allocation-through-cel)
provides the expression, curve and exact boundary semantics.

Reserve an execution slot even for a PoW-free operation; do not let parallel
requests all claim the first slot. Unsolved challenges are not execution slots.
At proof submission, check current price and hard guards, require sufficient
work, consume evidence and reserve execution before the protected operation.
Bind issued profile/level to the requirement, generation, operation and policy
revision. A cheap proof cannot be reused for a later more expensive attempt.
The ceiling caps work, not the server's independent hard refusals.

For a precomputed KDF puzzle, vary a bounded search range within a profile family
while keeping per-trial KDF/memory cost fixed. This raises expected client work
while issuance still needs one fixed-cost evaluation. Never exponentially grow
server issuance cost or Argon2 memory from a user-influenced attempt count.
The v1 profile table above is fixed; production enablement and the allowed level
ceiling remain subject to real-device and integrated-load measurements.

## Backend evidence and the cloud

Replace the former unsigned `X-Zitadel-Risk-Signal` dictionary plus secret-injecting
proxy with one explicit app-plane exchange ([ADR 036](036-api-credential-planes.md)):

1. The flow exposes an opaque, short-lived `bot_context` bound to the protected
   action and requirement generation. It carries no authorization by itself.
2. A trusted backend evaluates its bot system for this incoming action and calls
   proposed `POST /api/v1/bot_protection/evidence`, authenticated server-to-server,
   with the context, configured source and normalized verdict. ZITADEL validates
   project/source ownership and the action binding. Do not offer a blind public
   relay to that credentialed endpoint.
3. ZITADEL returns an opaque scoped receipt. The backend removes incoming
   caller-supplied receipt/signal headers and forwards the receipt in
   `X-Zitadel-Bot-Evidence` on the corresponding public request. No project secret
   is attached to ordinary flow traffic. The receipt enters the same admission
   state machine; it is not a general clearance token.
4. Duplicate exchanges for the same context are idempotent. Expiry, target/action
   changes, superseded generations and consumption invalidate reuse. Arbitrary
   browser verdicts or headers have no authority. A direct API call without a
   receipt gets the configured challenge or refusal.

The extra backend round trip is deliberate; measure it on preview before rollout.
Directly signed customer assertions need a separate issuer-key/revocation design
and are not another v1 channel. Preserve credential-free static SPA proxies.

The hosted cloud uses this same integration: BotID in `apps/cloud-functions`, its
client in `apps/cloud-console`, no Vercel dependency in the Go service or general
login package. The current temporary `403 auth.bot_suspected` must be replaced
when admission is available. A suspicious verdict may require PoW, but must let
the flow render it and submit a valid solution through that same proxy. Test
prefixed and legacy paths and direct API bypass together. A verified crawler is
not automatically authorized to register an account.

## Keys, failure and rollout

[ADR 029](029-cryptography-secrets-and-key-lifecycle.md) owns dedicated per-project
bot key purposes: independent challenge-HMAC and full-key-HMAC secrets, plus a
separate encryption key for opaque contexts/receipts. Existing cookie, session,
provider and project API credentials are not those keys. Pin key versions on
requirements; retain old validation keys only for their short remaining lifetime.
Emergency revocation beats a pinned release and invalidates pending evidence.

Unavailable third-party verification uses only an explicitly configured fallback;
otherwise return a retryable error. Unavailable built-in keys/replay storage fail
the protected operation. Hard guards always win. Do not log secrets, proof bodies,
derived keys or receipts; expose bounded metrics for required/solved/expired/
replayed/denied/unavailable/abandoned outcomes.

Stage 1 completed desktop comparison and cross-language proof checks; Firefox,
shipping Safari, real Android/iOS, a slower device, GPU/native optimization,
issuance saturation, replay under concurrency and cloud latency remain unmeasured.
The matched comparison closes algorithm/library selection for v1. Keep production
adaptive enforcement disabled until the applicable device and admission gates
pass, and review the full protocol binding/implementation before release.
The [implementation plan](../design/flowengine/bot-protection-implementation.md) and
[matched benchmark report](../design/flowengine/pow-matched-benchmark-2026-11-02.md) distinguish
measured results from those remaining integration obligations.
