package server

import "github.com/zitadel/nextgen/internal/domain"

// devPasswordHasher is a stub [domain.FlowPasswordHasher] used until the
// real argon2id implementation lands. It stores the plaintext password
// prefixed with a sentinel so Verify can compare it back.
//
// TODO: replace with the real argon2id hasher. This implementation has
// zero security and must not be used in any deployed environment.
type devPasswordHasher struct{}

const devHashPrefix = "$plain$"

var _ domain.FlowPasswordHasher = devPasswordHasher{}

func (devPasswordHasher) Hash(plain string) (string, error) {
	return devHashPrefix + plain, nil
}

func (devPasswordHasher) Verify(plain, encoded string) (bool, error) {
	expected := devHashPrefix + plain
	return expected == encoded, nil
}
