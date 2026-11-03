# PoW v1 interoperability vectors

These MIT-licensed fixtures pin the construction in [ADR 019](../../../adrs/019-captcha-gate-and-bot-signals.md).
All keys, IDs, salts, nonces and solutions are **public test data**.

`pow-v1-vectors.json` contains one vector for each released PBKDF2 profile, including
counter zero, counters above 255 and the maximum level-four counter. It records
the exact context/body bytes, both server keys, the public projection, the derived
key, proof and parameter MAC. Level one exercises absent policy/config revisions.

`generate-pow-v1-vectors.mjs` independently derives these values with WebCrypto.
The Go protocol tests compare issuance byte for byte and verify the proofs.
Future browser/native solvers should consume this same fixture, rather than
copying the AGPL server or research implementation into a client package.

Run `moon run server:test-pow` for vectors and the Go race suite. Its default Go
test run also executes fuzz seeds. For bounded exploratory fuzzing, pass
`-- -run '^$' -fuzz FuzzParseProof -fuzztime 20000x -parallel 2` or replace the target
with `FuzzVerifyStoredChallenge`. The normal server test task includes the Go
tests and depends on `server:check-pow-vectors`.

Regenerate only after reviewing an intentional change with
`node docs/design/flowengine/testdata/generate-pow-v1-vectors.mjs` from the repository
root. An incompatible wire change needs a new protocol version and new fixtures;
do not overwrite these to make a failing compatibility check pass.
