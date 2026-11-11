// Package pow is an experimental PBKDF2 proof-of-work core. Its protocol and
// profiles are provisional. The signup service uses its level-one profile.
//
// Issue derives one solution; Verify checks a solution HMAC without deriving a key.
// IDs, expected operation bindings and a dedicated solution key come from the
// caller. Salt, nonce and counter randomness is puzzle material, not resource IDs.
//
// Verification alone does not grant admission or prevent replay. Before any
// admission, the caller needs bounded issuance, rate limits and atomic one-use
// consumption for the protected operation. Keys and StoredChallenge stay in authenticated, private storage.
package pow
