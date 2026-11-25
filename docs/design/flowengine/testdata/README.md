# Experimental PoW interoperability vectors

These MIT-licensed fixtures check the [PBKDF2 experiment](../bot-protection-implementation.md).
All keys, IDs, salts, nonces and solutions are **public test data**.

`pow-v1-vectors.json` contains one vector for each experimental PBKDF2 profile, including
counter zero, counters above 255 and the maximum level-four counter. It records
the exact context/body bytes, the server solution key, the public projection, the derived
key and proof. The verifier body contains the solution MAC; authenticated
storage supplies parameter integrity.

`generate-pow-v1-vectors.mjs` independently derives these values with WebCrypto.
The Go protocol tests compare issuance byte for byte and verify the proofs.
The generator also writes the first vector's public challenge and proof into the
component package for the Chromium solver tests; `--check` verifies both fixtures.
Future solvers should use these vectors rather than copying the AGPL server or
research implementation into a client package.

Run `turbo run test:pow --filter=@zitadel/server` for vectors and the Go race suite. Its default Go
test run also executes fuzz seeds. For bounded exploratory fuzzing, pass
`-- -run '^$' -fuzz FuzzParseProof -fuzztime 20000x -parallel 2` or replace the target
with `FuzzVerifyStoredChallenge`. The server's `test` includes the Go tests, and
its `lint` runs `check-pow-vectors`.

Regenerate after reviewing an intentional change with
`node docs/design/flowengine/testdata/generate-pow-v1-vectors.mjs` from the repository
root. The protocol is provisional, with no released compatibility promise;
review changes to the construction before updating the reference values.
