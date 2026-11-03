# Minimal signup proof of work

> **Status:** Implemented for the Flow API's password `create_user` mutation.
> The protocol identifier remains provisional: `zitadel_pow_poc_v1`.

The default signup renders `step.gates.signup_pow` on its password step. The
server injects this gate by the step's `on_success: create_user`, independent of
its name, purpose or template. Editing the template cannot remove enforcement.
There is no new endpoint, provider registry, policy or configuration surface.

## Request path

1. Rendering the signup step reuses its live challenge or issues one with a
   five-minute lifetime. The browser receives only the public puzzle.
2. On submit, `<zitadel-login>` refreshes the step and solves the puzzle through
   native asynchronous Web Crypto. The existing loading state covers this work.
   It submits the full proof as the JSON string `gate_proofs.signup_pow`.
3. The shared signup handler verifies and atomically consumes the proof before
   allocating a user ID, hashing the password or running user mutations.
4. Only one concurrent submission can consume it. A failed mutation still spends
   the proof. Re-rendering or retrying obtains another challenge. Field/identifier
   validation failures before verification leave the pending challenge usable.

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
The server issues with one KDF and verifies with HMACs, without running a KDF.

The crypto core retains profiles for 512, 1,024, 2,048 and 4,096 trials. The live
signup path and browser solver enable level one only. Unknown profiles fail
closed; adding an algorithm later requires a new supported profile and solver.
No client-selected iteration or memory parameters are accepted.

Each project has a fixed one-minute budget of **60 new challenges** and **120
proof submissions**, committed before cryptographic work. Exhaustion returns
`429 flow.rate_limited`. Refreshing an existing live challenge is free. Budgets
are shared across replicas and cannot be reset by creating another flow or
spoofing a forwarded IP header. They are deliberately conservative project-wide
caps; one noisy client can exhaust the project's budget. Per-client fairness,
configurable limits and increasing cost are deferred. Normal ingress request
limits remain necessary; this gate does not rate-limit all Flow API requests.

## Persistence and secrets

SQLite, PostgreSQL and Spanner store pending challenges and counters. Project
locks serialize budget updates and issuance; compare-and-delete consumes a proof
once. Issuance and consumption emit audit events in their transactions. Expired
rows are cleaned up when that project issues a challenge; inactive projects keep
only their last bounded batch until the next issuance or project deletion. Each
project has one counter row. There is no new background worker.

Each challenge has independent random 256-bit HMAC keys. The server encrypts the
keys and stored challenge with the existing project secret crypter; the JWE key
ID supports reads after key rotation. Cookie/password keys are not used as PoW
MAC keys. Salt, nonce and counter randomness is puzzle material; resource IDs
come from the storage dialect. PBKDF2, randomness and key-service calls stay
outside retryable database transactions.

The browser solver has a 512-trial bound and a 30-second/expiry deadline. It
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

`moon run server:test-pow` checks the Go core and independent Web Crypto vectors.
Portable storage tests cover atomic replay rejection, project/flow isolation,
expiry and shared quotas. HTTP tests cover signup refusal, acceptance and cookie
replay. Component tests exercise the signup exchange; Chromium tests check the
solver against the same [public MIT vectors](testdata/README.md).
