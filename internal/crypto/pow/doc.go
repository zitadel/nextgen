// Package pow is an experimental PBKDF2 proof-of-work core. Its protocol and
// profiles are provisional; no endpoint or authentication flow uses it.
//
// Issue derives one solution; Verify checks HMACs without deriving a key.
// IDs, expected operation bindings and independent purpose keys come from the
// caller. Salt, nonce and counter randomness is puzzle material, not resource IDs.
//
// Verification alone does not grant admission or prevent replay. Before any
// public use, the caller needs bounded issuance, rate limits and atomic one-use
// consumption for the protected operation. Keys and StoredChallenge stay private.
package pow
