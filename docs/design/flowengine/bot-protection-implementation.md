# Bot protection implementation: PBKDF2 default, configurable algorithms

> **Status:** PR 1 protocol core implemented; persistent admission and rollout qualification pending.
> **Date:** 2026-11-02
> **Contract:** [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md).
> **Design details:** [Admission, policy and integration design](bot-protection-plan.md).
> **Evidence:** [Matched PBKDF2/Argon2id benchmark](pow-matched-benchmark-2026-11-02.md).

Ship a ZITADEL-owned, internally issued and verified PoW gate with **PBKDF2-HMAC-
SHA-256 as the default**. Build the algorithm/profile boundary in the first PR,
so a project can select another supported algorithm later without replacing the
admission service, flow gate or evidence integrations. Initially only the measured
PBKDF2 profiles are enabled; Argon2id requires its own implementation and release
qualification. No ALTCHA server, hosted verifier or runtime library is required.

The first usable slice protects self-service signup and password checks through
the shared operation service, including direct API calls. Cloud BotID and customer
evidence enter that same service. Progressive CEL pricing follows once atomic
attempt accounting is proven. Customer provider adapters and additional KDFs are
separate increments, not prerequisites for the first internal PBKDF2 path.

## Implementation progress

PR 1 is implemented in [internal/crypto/pow](../../../internal/crypto/pow/doc.go):
an immutable four-profile PBKDF2 registry, one-KDF issuance, independent
HMAC-only verification, strict bounded proof/stored-body parsing and complete
requirement binding. `enabled`, `verify_only` and `disabled` availability is
supplied by the caller; the package deliberately owns no local revocation cache.
It has no password-hasher, ALTCHA or external-service dependency.

The [permanent MIT-licensed vectors](testdata/README.md) independently use
WebCrypto and match Go issuance byte for byte, including both MACs. The focused
`moon run server:test-pow` task runs the vector check and Go race suite; the normal
server test task also includes these checks. Tests cover all four levels, every
binding, profile retirement, expiry boundaries, parsing limits and malformed
authenticated storage. Two fuzz targets cover proof and stored-body parsing.

This is **not an enabled bot gate**. Crypto verification intentionally accepts
the same valid proof again until the admission layer atomically consumes it.
PR 2 is the next dependency: purpose-key resolution, persistent requirements,
issuance/execution reservations, generation fencing and one-use admission on all
three storage dialects. No API, flow, policy, SDK or UI behavior changes in PR 1.
The existing Passwap password path remains unchanged.

## Passwap assessment

The repository already depends on `github.com/zitadel/passwap v0.12.1` in
[go.mod](../../../go.mod) and uses it through
[PasswapHasher](../../../internal/crypto/passwap.go) and
[the project password resolver](../../../internal/service/password_hasher.go).
I inspected that version, the upstream algorithm implementations on `main`, and
the [latest release](https://github.com/zitadel/passwap/releases/tag/v0.12.1)
reported on 2026-11-02. This is a source/API assessment; Passwap was not added as
a new benchmark candidate.

| Capability | Passwap today | Fit for this PoW implementation |
|---|---|---|
| PBKDF2 and Argon2id primitives | Wraps `golang.org/x/crypto` KDFs | Same class of primitives already measured; no new cryptographic implementation needed |
| Password hashing | `Hash(string)` generates a salt and returns a full encoded password hash | Could be adapted for issuance by parsing its result, but introduces encoding work and does not provide the raw-key API we need |
| Password verification/migration | Verifies an encoded hash with a KDF; `Swapper` can rehash to the current method | Keep for passwords; PoW verification must remain HMAC-only and challenges expire instead of being rehashed |
| Bounds checking | Separate `Validate` API and algorithm-specific limits | Useful design pattern; PoW needs its own immutable profiles and issuer CPU/memory/concurrency limits |
| Algorithm selection | Hasher plus a list of fallback password verifiers | Useful separation of issuing and reading old formats; proof acceptance must use the exact stored profile, with no verifier probing |
| Browser solving and admission | No browser solver, context MACs, replay ledger or operation accounting | ZITADEL's PoW worker and admission service still implement these |

The important API differences are visible in the pinned
[PBKDF2 source](https://github.com/zitadel/passwap/blob/v0.12.1/pbkdf2/pbkdf2.go),
[Argon2 source](https://github.com/zitadel/passwap/blob/v0.12.1/argon2/argon2.go)
and [Swapper](https://github.com/zitadel/passwap/blob/v0.12.1/passwap.go):

- The hashers expose encoded hashes, not an exported operation that derives raw
  bytes from a caller-supplied salt. Their salt readers and raw derivation paths
  are internal. Encoding then decoding a password hash is possible, but adds an
  adapter without supplying challenge binding, HMAC verification or replay safety.
- The encoded value contains the **full derived key**. Publishing it as a PoW
  challenge would give the client the solution. Keep only the public prefix and
  the server's authenticators specified by ADR 019.
- `Swapper.Verify` explicitly assumes bounds were checked separately; it is not
  a bounded verifier for an untrusted proof envelope. Password verification also
  recomputes the KDF, which is deliberately absent from the PoW verification path.
- Password defaults are separate: the inspected SHA-256 PBKDF2 recommendation is
  290,000 rounds, while the PoW profile has 5,000 per trial; Argon2id defaults use
  four lanes, while the measured PoW candidates use one. Neither policy should
  inherit the other's parameters or algorithm allowlist.

**Decision:** use Go `crypto/pbkdf2` behind the PoW derivation interface for the
first release; retain Passwap for password hashing and migration. Borrow its
separation of current issuance from old-format verification, without importing
its password hash format or automatic migration into PoW.

If shared ownership in Passwap becomes useful, propose an additive **raw-key
derivation API** there: caller-supplied input and salt, explicit typed parameters,
bounded validation and raw output, without salt generation, encoding or rehashing.
Adapt the issuer behind the same interface only after byte-for-byte vectors and
matched issuance benchmarks pass. Leave profiles, MACs, browser solving and
admission in nextgen. This is optional follow-up, not a dependency of the first
release. This planning change does not modify the upstream library.
Passwap's [BSD-3-Clause license](https://github.com/zitadel/passwap/blob/v0.12.1/LICENSE)
is not an obstacle to reuse with its notices, but does not solve the API mismatch.

## Boundaries to implement first

Keep these responsibilities separate:

| Boundary | Owns | Must not own |
|---|---|---|
| PoW profile registry | Immutable protocol/algorithm/parameter/level entries; issue/verify availability; cost metadata | Client-supplied parameters or automatic fallback algorithms |
| Issuer and derivation adapter | Fixed-profile KDF call, randomness, parameter/solution MACs | Password-hasher defaults, password migration or database retries around KDF work |
| Proof verifier | Strict decoding, stored challenge authentication, binding and expiry checks, full-key MAC comparison | KDF evaluation or an algorithm inferred from the submitted proof |
| Admission service | Guards, requirements, one-use consumption, execution reservations, target/policy scope | Session authentication factors or browser-only enforcement |
| Project bot configuration | Chosen default algorithm and allowed evidence/provider connections | Raw KDF tuning, mutable counters or arbitrary code |
| CEL policy | Whether evidence is needed and a bounded `pow_level` from trusted context | Algorithm selection, counting, cryptography or I/O |
| Client solver registry | Known profile implementations, bounded workers and cancellation | Choosing cheaper work than the issued requirement |

Use the pure Go package under `internal/crypto/pow`, rather
than extending `crypto.PasswordHasher`. A registry entry fixes `profile_id`,
`protocol`, `algorithm`, KDF parameters, input/output framing, work level, maximum
trials and issuer resource estimates. Use immutable typed definitions; the initial
four entries are the PBKDF2 table in ADR 019. Level zero creates no challenge.
Keep mutable availability/revocation state separate from immutable profile
parameters. Emergency changes must use an authoritative shared status/epoch and
cache invalidation across replicas, not only a process-local flag. The admission
transition checks that status again before allowing the protected operation.
Reserve bounded issuance capacity before deriving. PBKDF2 needs CPU/concurrency
and request budgets; a future Argon2 family also needs a global memory budget
with measured GC/runtime headroom, not just `configured_memory × worker_count`.
Bound the waiting queue and per-project share as well as active derivations.

The derivation interface accepts an already resolved profile and input/salt bytes;
only the issuer and test/native solvers call it. The verifier receives stored
context and authenticators and cannot invoke a password verifier or deriver.
Separate structural types make that restriction testable with a spy deriver.
Do not copy the research package into a shipping MIT browser package; implement
the documented framing with appropriately licensed shared fixtures.

## Configuration and later algorithm changes

Add `algorithm` to the built-in provider configuration **now**, with
`pbkdf2_sha256` as its canonical default. The field initially accepts only that
value. A future release may add `argon2id` after it has an approved profile family
and matching client solver. Unsupported values fail configuration/deployment
validation; there is no "best effort" substitution.

Algorithm choices belong to the revisioned `bot_protection` resource. The
[configuration example](bot-protection-plan.md#configuration-and-policy) is the
proposed file/API shape. Omission resolves to a concrete default in the pinned
revision, so a later binary cannot silently reinterpret an old deployment.
The operator bounds the permitted algorithms, enabled profiles and issuance
budgets. Projects select within those limits; CEL selects only a work level.

`protocol` versions the envelope/construction; `profile_id` fixes the algorithm
and every KDF/work parameter. Adding a compatible KDF uses new immutable profile
IDs and implementations. Only incompatible framing, binding or proof semantics
requires a new protocol version. The first-party and custom clients dispatch by
the issued profile; unsupported profiles produce an explicit unsupported result,
not an algorithm negotiation that lowers protection. ADR 019 owns the normative
compatibility and lifecycle rules.

For future algorithm changes:

1. Qualify the new family on native clients, relevant attacker implementations,
   real devices and all supported browsers; budget issuance CPU/RAM separately.
2. Ship registry entries and a matching browser/SDK solver before allowing a
   deployment to select the family. Check all serving replicas and the pinned
   asset/SDK compatibility requirements during rollout.
3. Publish a new bot-config revision and deployment selecting the new algorithm.
   Existing requirements stay bound to their original revision/profile and TTL;
   new deployment contexts use the selected family. Do not rehash pending work.
4. Retain verification support while old issued challenges can still be valid.
   A `verify_only` family drains issued work but cannot mint fresh challenges,
   including for an old pinned deployment. Such a deployment must be moved or
   fail with an actionable unavailable result. Emergency `disabled` status rejects
   pending work immediately. Rollback never revives revoked profiles or keys.
5. Do not compare level numbers across families. A proof at Argon2 level 2 does
   not automatically satisfy PBKDF2 level 2. Within a family, compare the issued
   profile against the current required level only after exact requirement and
   generation matching. Across families, supersede/reissue when required by the
   new operation context or an emergency rule; never reinterpret an old proof.

The same public salt/nonce/prefix/derived-key shape can support the measured
Argon2id construction later. The first release still rejects its experimental
IDs. Customer algorithms mean supported choices from a released registry, not
uploaded Go/WASM code, arbitrary KDF settings or remote verification URLs.

## Ordered implementation PRs

The benchmark and PR 1 core are complete. The following increments are the
implementation sequence, not claims that the whole feature is available. Each PR includes the relevant generated
contract updates, transactional audit events and product Changeset when it changes
shipped behavior. Keep public activation disabled until the complete path passes.

| PR | Depends on | Deliverable and concrete exit check |
|---|---|---|
| 1. Protocol core and profiles — implemented | — | Pure issuer/verifier, immutable registry, four PBKDF2 profiles and permanent byte vectors. Malformed/duplicate/oversized proofs, wrong scope/key/profile/expiry and unknown versions are tested. The verifier has no derivation dependency; future algorithms remain disabled. |
| 2. Keys and persistent admission state | 1 | Dedicated key purposes; storage-owned IDs; requirement/generation/consumption records; operation execution reservations and bounded leases/fencing. Add migrations and statement contracts on Postgres, SQLite and Spanner. Concurrent consumption has one winner; a failed credential attempt spends admission; crashes and replayed cookies cannot revive it. Audit state mutations in their transactions. |
| 3. Revisioned configuration and release support | 1 | `bot_protection` resource, explicit/defaulted algorithm, operator allowlist, release pointers, frozen variables, export/build/deploy validation, API/CLI metadata and schemas. Initially accept only the built-in PBKDF2 provider and implemented source types. Test omitted/default/unknown algorithms, release pinning, rollback and disabled profiles. |
| 4. Shared operation enforcement and static policy | 2, 3 | Admission orchestration, bounded issuance/refresh, requirement reuse, independent hard guards and static `require_bot_evidence`/`require_bot_challenge` consumers. Wire signup and password verification before expensive preparation; add any missing ADR 078 guard foundation explicitly. Tests call services directly, without a flow or gateway, and cannot bypass required admission. |
| 5. Flow/API/custom-client contract | 4 | Runtime named gates, proof routing, requirement responses and auth-attempt delegation to separate bot state. Author OpenAPI sources, regenerate server/SDKs, update mock fixtures against the default flow and document native-client solving. Missing proofs refuse protected execution; valid PoW never becomes an AuthFactor or raises assurance, and invalid bot proofs do not enter password-failure accounting. |
| 6. Browser worker and login component | 1, 5 | PBKDF2 WebCrypto worker, local profile dispatcher, `<zl-captcha>`, mandatory-consumer injection, proof collection and same-origin asset delivery. Storybook covers working/retry/unsupported/CSP/error states. One real browser-to-server test completes the gate; navigation, supersession and duplicate submits do not cause stale work or extra executions. |
| 7. Progressive CEL allocation | 2, 4, 6 | Typed integer output, trusted failure/window/reservation context, ten-free/five-per-level example, finite profile mapping, ceiling and audit mode. With zero prior failures, a concurrent burst admits at most ten PoW-free checks under that example. Cover band boundaries, resets/decay, insufficient stale price, no double counting, lease fencing and independent hard refusals. |
| 8. Customer backend evidence and Cloud BotID | 3–6 | App-plane context/receipt exchange, configured trusted sources and server SDK helper; cloud calls it after BotID. Replace the temporary proxy block only when the operation service enforces the rule. Test direct-API bypass, forged/replayed receipts, and suspicious BotID allowing render and submission of the permitted PoW fallback. |
| 9. Customer challenge provider | 3–6 | Turnstile first, with server-held secrets, bounded verifier calls, action/host checks, one-use local admission, timeout and configured fallback. Exercise outage and duplicate-token behavior. Add further vendors only through the same adapter contract. |
| 10. Qualification and controlled activation | 1–7; 8 for cloud; 9 for vendor-enabled projects | Real-device/browser matrix, protocol review, mixed-replica replay/key tests and integrated HTTP/DB load. Set operator budgets and enabled level ceiling from results; enable in the platform preview, then production with explicit rollback controls. Static rollout can precede adaptive activation; do not advertise exact free allowances until PR 7 is proven. |
| Later: additional algorithm | 1–7 plus its own qualification | Add a registered family, worker/native vectors, memory-aware issuer budgets and an explicit project configuration choice. Prove rolling upgrade, live old challenges, unsupported clients, retirement, revocation and rollback. Changing algorithm does not require rewriting the admission service. |

PRs 1–6 provide the first complete internal PBKDF2 path. PR 7 adds the increasing
cost policy. The cloud activation gate is PR 8 plus the cloud checks in PR 10;
customer-owned provider credentials are not required for the built-in path.
The optional Passwap raw-key API can be evaluated independently after PR 1 and
must preserve the same vectors and profiles if adopted.

## Code integration points that determine ordering

- In [auth_attempt.go](../../../internal/service/auth_attempt.go), `VerifyProof`
  calls `s.verify` before opening the success transaction; the password branch
  performs `password.Verify` and possibly a rehash there. Admission/reservation
  must precede that branch's KDF work. Adding checks only to
  `AuthAttemptChallengeSucceeded` is too late.
- [UserService.ApplyActions](../../../internal/service/user.go) calls every
  action's `Prepare` before opening the mutation transaction.
  `SetPasswordUserAction.Prepare` hashes the password. The trusted self-service
  operation entry point must admit before preparation, with a fenced reservation
  checked again for the result/commit; do not insert admission only in `Apply`.
  Cover [flow password signup](../../../internal/service/flow_create_user_with_password_handler.go),
  provisional passkey signup, SSO creation and direct API paths. Operator/import
  context must be constructed by the server, never a request-supplied exemption.
- Reuse existing Passwap password verification/migration after admission. Do not
  change [PasswordHasher](../../../internal/crypto/hash.go) or derive the PoW
  algorithm from a user's password hash or project password-setting policy.
- Issue KDFs, provider calls and proof verification outside retryable transactions.
  Recheck the stored generation, profile status, expiry, guards and consumption in
  the short authoritative transition. Bound issuance reservations before KDF work
  as well as execution reservations before protected work.
- Update the event catalog with each state mutation, and use shared `stmttest`
  contracts for cross-dialect semantics. Follow the scoped AGENTS.md for each
  implementation path; the [existing design's code map](bot-protection-plan.md#main-code-surfaces)
  names API, release, configuration, CLI, component and cloud starting points.

## Acceptance and release boundaries

Use the [existing verification matrix](bot-protection-plan.md#verification-and-rollout-gates)
at the lowest layer that proves each property. Extend it with omitted/default
algorithm resolution, registry completeness, same-family versus cross-family
pricing, old-profile retention, revocation, unsupported clients and mixed-version
deployment/rollback. Profile parameters must never mutate in place.

Run the scoped Moon tasks as each PR lands: core Go tests/fuzzing; portable
statement suites on all three dialects; OpenAPI/generation drift checks; affected
configuration/CLI/SDK tests; component and Storybook checks; then the relevant
real-server journey. Keep primitive timing separate from integrated admission
load. No new performance claim or Passwap speedup is implied by this plan.

The [benchmark](pow-matched-benchmark-2026-11-02.md) still leaves Firefox launch
coverage, shipping Safari, physical Android/iOS, slow devices, optimized attacker
economics and production admission capacity open. PBKDF2 is the default selected
for implementation. Enabled production levels, free allowance, window/stride and
operator budgets are deployment decisions after calibration, not conclusions
drawn from one desktop. Unknown/unavailable evidence never disables hard guards.
