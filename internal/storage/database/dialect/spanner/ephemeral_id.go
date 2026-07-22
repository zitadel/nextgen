package spanner

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
)

// NewEphemeralID returns a uniformly random positive int64 for ephemeral
// resource identifiers (ADR 011) written through this dialect.
//
// ADR 011's default for ephemeral ids is a database-generated bit-reversed
// identity, but go-sql-spanner retries aborted read-write transactions by
// replaying their statements and comparing results: a THEN RETURN of a fresh
// identity draw diverges on replay and fails the transaction with
// ErrAbortedDueToConcurrentModification. Values must therefore be chosen
// client-side; per ADR 028 the generation strategy is dialect-owned, which is
// why this lives here and not in idgen. Uniform randomness spreads keys like
// bit-reversed identities do, avoiding range hotspots.
//
// Uniqueness is probabilistic (collision odds ~2^-63 per insert against the
// existing keyspace). A collision surfaces as a key-conflict error on the
// insert; retrying inside the same transaction would be non-deterministic on
// replay, so callers let the operation fail and leave the retry to the flow
// level. See ADR 011 § Spanner client-generated exception.
func NewEphemeralID() (int64, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0, fmt.Errorf("generate ephemeral id: %w", err)
	}
	id := int64(binary.BigEndian.Uint64(b[:]) &^ (1 << 63))
	if id == 0 {
		id = 1
	}
	return id, nil
}
