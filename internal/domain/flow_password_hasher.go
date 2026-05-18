package domain

import "errors"

// FlowPasswordHasher is the seam the flow engine's on_success handlers
// use to produce and verify password hashes. The encoded form is the
// PHC string (`$argon2id$...`) stored on [UserPassword.EncodedHash];
// callers never see plaintext after Hash returns.
//
// A production implementation backed by argon2id lands with the
// credentials work; the flow engine accepts an interface so PR 6 can
// ship `create_user` and `verify_credentials` with a stub
// implementation in tests.
type FlowPasswordHasher interface {
	// Hash derives an encoded PHC string from the plaintext password.
	Hash(plain string) (encoded string, err error)

	// Verify reports whether the plaintext matches the encoded hash.
	// A non-nil error signals a hasher-level failure (malformed
	// encoding, unsupported algorithm); a mismatch is reported as
	// (false, nil), not as an error.
	Verify(plain, encoded string) (ok bool, err error)
}

// ErrPasswordHashUnsupported is returned by [FlowPasswordHasher]
// implementations when the encoded hash uses an algorithm or
// parameter set the hasher cannot evaluate.
var ErrPasswordHashUnsupported = errors.New("flow password hasher: encoded hash uses unsupported algorithm")
