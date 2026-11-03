// Package pow implements the cryptographic core of zitadel_pow_v1 (ADR 019).
//
// Issue must run after reserving bounded issuance capacity, outside retryable
// database transactions. Resource IDs and key versions come from storage; random
// salt, nonce and counter bytes are puzzle material, never resource IDs.
//
// Verify authenticates one proof against an authoritative requirement. It does
// not grant admission: the caller must atomically recheck expiry, generation,
// revocation, hard guards and one-use consumption before protected work. Resolve
// keys by the requirement's project, purpose and version, never by proof fields.
// Neither these keys nor StoredChallenge may be sent to a client.
//
// This package has no database, network, password-hasher or mutable registry
// dependency. Availability is a snapshot supplied by the admission service, not
// a process-local substitute for shared revocation state. No public endpoint is
// enabled by this package.
package pow
