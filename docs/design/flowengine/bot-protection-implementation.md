# PBKDF2 proof-of-work POC

> **Status:** Experimental core only. No endpoint, flow gate or admission policy is enabled.

This experiment checks whether ZITADEL can issue a bounded PBKDF2 puzzle and
verify its solution cheaply with HMACs. It uses Go's standard library and
WebCrypto, with no new runtime dependencies. Passwap remains untouched.

The implementation is [internal/crypto/pow](../../../internal/crypto/pow/doc.go).
Its protocol identifier is `zitadel_pow_poc_v1`; both the protocol and profiles
are provisional. This does not finalize the proposed flow contract in
[ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md).

## Small, fixed experiment

The default algorithm is `pbkdf2_sha256`. Each trial uses 5,000 iterations,
a 16-byte salt, and a 32-byte output. The input is a 16-byte nonce followed by a
four-byte big-endian counter. Issuance samples the hidden counter uniformly and
performs one KDF; the client searches for the published first 16 output bytes.

| Level | Maximum trials |
| --- | --- |
| 1 | 512 |
| 2 | 1,024 |
| 3 | 2,048 |
| 4 | 4,096 |

Level zero means the caller issues no puzzle. The algorithm/profile boundary
allows a future implementation to add a supported algorithm; unknown algorithms,
levels and client-supplied KDF parameters are rejected. There is no provider or
profile-retirement framework in this POC.

## Correctness boundaries

The caller supplies the project, operation, operation-instance ID, challenge ID,
profile and expiry. The operation instance must privately pin the protected
input; changing that input needs a new instance. Resource IDs come from storage.
Passwords and other protected inputs are never part of the challenge.

Two independent 256-bit keys authenticate the exact stored context/full solution
and the stored challenge body, using distinct HMAC domains. The client receives
only the protocol, challenge/profile IDs, salt, nonce, key prefix and expiry. Its
proof contains the protocol, challenge ID and full derived key. Verification
checks the expected binding, expiry, prefix and MACs without running a KDF.

Proofs are limited to 2 KiB, stored bodies to 4 KiB and validity to five minutes.
Strict parsing rejects unknown or duplicate fields, case aliases, nulls, trailing
data and malformed hex. Reference vectors cover all levels, counter framing and
Go/WebCrypto agreement; negative tests and fuzzing cover hostile inputs.

## Next validation

A successful proof currently remains reusable: this package has no admission
store. Before public use, demonstrate one protected operation through a browser,
with bounded issuance, atomic one-use consumption and independent rate limits.
Then exercise ten free attempts followed by increasing cost, including concurrent
requests. Those are follow-up experiments, not implemented behavior.

Production key lifecycle, release/configuration integration, CEL accounting,
customer providers and Cloud BotID remain outside this change. PoW demonstrates
work, not humanity; desktop results alone do not establish attacker economics or
acceptable mobile cost.

## Run

`moon run server:test-pow` checks the independent WebCrypto vectors and runs the
Go race suite. The normal server tests also include the core and vector check.
See [the fixture instructions](testdata/README.md) for bounded fuzzing and vector
regeneration. All fixture keys and identifiers are public synthetic data.
