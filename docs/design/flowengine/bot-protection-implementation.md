# Minimal signup proof of work

> **Status:** Implemented for the Flow API's password `create_user` mutation.
> The protocol identifier remains provisional: `zitadel_pow_poc_v1`.

The default signup announces `step.gates.signup_pow` on its password step.
Start and Submit do not issue challenges; GET prepares the public puzzle. The
server injects this gate by the step's `on_success: create_user`, independent of
its name, purpose or template. Editing the template cannot remove enforcement.
There is no new endpoint, provider registry, policy or configuration surface.

## Request path

1. GET of the signup step reuses a challenge with more than a minute remaining
   or issues one with a five-minute lifetime. The browser receives only the public puzzle.
2. On submit, `<zitadel-login>` refreshes the step and solves the puzzle through
   native asynchronous Web Crypto. The existing loading state covers this work.
   It submits the full proof as the JSON string `gate_proofs.signup_pow`.
3. The shared signup handler verifies and atomically consumes the proof before
   allocating a user ID, hashing the password or running user mutations.
4. Only one concurrent submission can consume it. A failed mutation still spends
   the proof. Re-rendering or retrying obtains another challenge. Password policy and field/identifier
   validation failures before consumption leave the pending challenge usable.

A proof authorizes one signup attempt within one project and flow. It does not
prove humanity, authenticate a user, or bind a password chosen after issuance.
It is never an authentication factor. Replaying an older flow cookie does not
restore a spent challenge. Missing, malformed, expired and spent proofs return
`403 flow.proof_invalid`; the client can refresh and retry.

## Fixed initial costs and limits

PBKDF2-HMAC-SHA256 is the default and only enabled algorithm. Signup uses
`pbkdf2_sha256_5000_l1`: 5,000 iterations per trial and at most 512 trials. Each
trial derives 32 bytes from `nonce || uint32_be(counter)` with a 16-byte salt.
The client matches the published first 16 bytes and sends the entire derived key.
The server issues with one KDF and verifies with a solution HMAC, without running a KDF.

The crypto core retains profiles for 512, 1,024, 2,048 and 4,096 trials. The live
signup path and browser solver enable level one only. Unknown profiles fail
closed; adding an algorithm later requires a new supported profile and solver.
No client-selected iteration or memory parameters are accepted.

Each flow has a fixed one-minute budget of **10 issuance attempts** and **20
proof submissions**, committed before cryptographic work. A malformed proof is
refused before the budget and spends none of it. Exhaustion returns
`429 flow.rate_limited`. Refreshing a reusable challenge is free. Replicas share
the counters; exhausting one flow cannot exhaust another flow's allowance.
Concurrent issuers may each spend an issuance attempt but return the same puzzle.
These are retry limits, not a defense against creating new flows. Deployments
must apply ingress request limits for that attack; this implementation does not
trust forwarded IP headers or impose a shared signup quota on a project.

## Persistence and secrets

SQLite, PostgreSQL and Spanner store pending challenges and per-flow counters.
Only the flow's counter row is locked for issuance and consumption; the project's
parent row is never explicitly locked. Compare-and-delete consumes a proof once,
with expiry sampled after the flow lock. Issuance and consumption emit audit
events in their transactions. One issuance in 16 also removes the project's expired
challenges and counters inactive for an hour, so concurrent signups in a project
rarely run the same delete. A failed sweep is logged and never fails the issuance.
Projects retain expired rows until a sampled issuance or project deletion. There is
no new background worker.

Each challenge has a random 256-bit solution HMAC key. The server encrypts this
key and the verifier body with the existing project secret crypter. JWE supplies
stored-parameter authentication, so no second parameter MAC/key is needed.
The public puzzle is stored separately and refreshes require no decryption.
The JWE key ID supports verification after key rotation. Cookie/password keys
are not reused. Resource IDs come from the storage dialect. PBKDF2, randomness
and key-service calls stay outside retryable database transactions.

The browser solver has a 512-trial bound and a monotonic 30-second deadline; server time alone decides expiry. It
cancels when the component disconnects, uses no third-party script, WASM or
worker bundle, and requires Web Crypto on a secure origin. Existing back and SSO
actions do not solve signup puzzles. Headless clients must implement the same
challenge/proof exchange; old clients without a solver receive a proof refusal.

## Scope and verification

CEL, ten free attempts followed by increasing costs, external providers, Cloud
BotID, algorithm configuration, and protection for SSO/passkey signup are deferred.
Passwap remains the password-hashing library; it is not needed for these fixed
protocol KDF parameters. There is no ALTCHA library or hosted service dependency.
Mobile calibration and attacker economics remain unvalidated.

`turbo run test:pow --filter=@zitadel/server` checks the Go core and independent Web Crypto vectors.
Portable storage tests cover atomic replay rejection, project/flow isolation,
expiry and flow-isolated quotas. HTTP tests cover signup refusal, acceptance, live-attempt proof replay and completed-cookie rejection. Component tests exercise the signup exchange; Chromium tests check the
solver against the same [public MIT vectors](testdata/README.md).

Start, Submit and GETs that resolve parked SSO state preserve a successful transition even if challenge
issuance is unavailable: they announce the gate without issuing. The next GET prepares the puzzle. The browser's
pre-submit GET can fail independently and be retried. Solver failures and proof
or rate refusals preserve the form; terminal flow errors and server faults use
the existing error screen. A solved proof is reused while its challenge remains
current, so correcting a policy-rejected password does not require another solve.
