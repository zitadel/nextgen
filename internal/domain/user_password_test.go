package domain

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
)

// limitedHasher refuses what it cannot take in full, the way bcrypt does past
// 72 bytes.
type limitedHasher struct{ maxBytes int }

func (h limitedHasher) Hash(_ context.Context, password string) (string, error) {
	if len(password) > h.maxBytes {
		return "", crypto.ErrPasswordTooLong
	}
	return "plain$" + password, nil
}

// plainHasher stores the password as its own "hash", so a test can see exactly
// what was hashed.
type plainHasher struct{}

func (plainHasher) Hash(_ context.Context, password string) (string, error) {
	return "plain$" + password, nil
}

func (plainHasher) VerifyHash(_ context.Context, encoded, password string) error {
	if encoded != "plain$"+password {
		return errors.New("mismatch")
	}
	return nil
}

const (
	composed   = "café-au-lait"  // é as one code point
	decomposed = "café-au-lait" // e + combining acute accent
)

func TestNormalizePassword(t *testing.T) {
	t.Parallel()

	assert.Equal(t, composed, NormalizePassword(decomposed))
	assert.Equal(t, composed, NormalizePassword(composed))
	assert.Equal(t, "plain ascii", NormalizePassword("plain ascii"))
}

func TestHashPassword(t *testing.T) {
	t.Parallel()

	t.Run("hashes the normalized password", func(t *testing.T) {
		t.Parallel()
		hash, err := HashPassword(t.Context(), decomposed, plainHasher{})
		require.NoError(t, err)
		assert.Equal(t, "plain$"+composed, hash)
	})

	t.Run("accepts 64 code points and hashes all of them", func(t *testing.T) {
		t.Parallel()
		// 64 code points but 128 bytes: the limit counts code points.
		password := strings.Repeat("ü", MaxPasswordLength)
		hash, err := HashPassword(t.Context(), password, plainHasher{})
		require.NoError(t, err)
		assert.Equal(t, "plain$"+password, hash, "nothing is truncated")
	})

	t.Run("counts the length after normalization", func(t *testing.T) {
		t.Parallel()
		// 128 code points as typed, 64 once each pair composes.
		password := strings.Repeat("ü", MaxPasswordLength)
		hash, err := HashPassword(t.Context(), password, plainHasher{})
		require.NoError(t, err)
		assert.Equal(t, "plain$"+strings.Repeat("ü", MaxPasswordLength), hash)
	})

	t.Run("rejects more than 64 code points", func(t *testing.T) {
		t.Parallel()
		_, err := HashPassword(t.Context(), strings.Repeat("a", MaxPasswordLength+1), plainHasher{})
		assert.ErrorIs(t, err, ErrUserPasswordTooLong())
	})

	t.Run("rejects what the hashing algorithm cannot take in full", func(t *testing.T) {
		t.Parallel()
		// 64 code points, accepted by the length rule, but 128 bytes.
		_, err := HashPassword(t.Context(), strings.Repeat("ü", MaxPasswordLength), limitedHasher{maxBytes: 72})
		assert.ErrorIs(t, err, ErrUserPasswordTooLong())
	})

	t.Run("rejects an empty password", func(t *testing.T) {
		t.Parallel()
		_, err := HashPassword(t.Context(), "", plainHasher{})
		assert.ErrorIs(t, err, ErrUserPasswordEmpty())
	})
}

func TestUserPassword_Verify(t *testing.T) {
	t.Parallel()

	t.Run("either composition matches a normalized hash", func(t *testing.T) {
		t.Parallel()
		hash, err := HashPassword(t.Context(), composed, plainHasher{})
		require.NoError(t, err)
		pw := &UserPassword{EncodedHash: hash}
		assert.NoError(t, pw.Verify(t.Context(), composed, plainHasher{}))
		assert.NoError(t, pw.Verify(t.Context(), decomposed, plainHasher{}))
		assert.ErrorIs(t, pw.Verify(t.Context(), "cafe-au-lait", plainHasher{}), ErrUserPasswordInvalid())
	})

	t.Run("applies no length limit", func(t *testing.T) {
		t.Parallel()
		long := strings.Repeat("a", MaxPasswordLength+1)
		pw := &UserPassword{EncodedHash: "plain$" + long}
		assert.NoError(t, pw.Verify(t.Context(), long, plainHasher{}))
	})
}

// busyHasher is a hasher whose limiter refused the slot.
type busyHasher struct{}

func (busyHasher) Hash(context.Context, string) (string, error) { return "", crypto.ErrHashingBusy }

func (busyHasher) VerifyHash(context.Context, string, string) error { return crypto.ErrHashingBusy }

// ctxHasher answers with whatever ended the context it was given.
type ctxHasher struct{}

func (ctxHasher) VerifyHash(ctx context.Context, _, _ string) error { return ctx.Err() }

// A server that is hashing as much as it allows is not a verdict on the
// password: the caller gets a code of its own, never "invalid".
func TestHashPassword_busy(t *testing.T) {
	t.Parallel()

	_, err := HashPassword(t.Context(), composed, busyHasher{})
	assert.ErrorIs(t, err, ErrUserPasswordHashingBusy())
	assert.ErrorIs(t, err, crypto.ErrHashingBusy, "the cause stays attached for the log")
	assert.NotErrorIs(t, err, ErrInternal(nil))
}

func TestUserPassword_Verify_checkDidNotRun(t *testing.T) {
	t.Parallel()

	pw := &UserPassword{EncodedHash: "plain$" + composed}

	t.Run("busy is reported as busy", func(t *testing.T) {
		t.Parallel()
		err := pw.Verify(t.Context(), composed, busyHasher{})
		assert.ErrorIs(t, err, ErrUserPasswordHashingBusy())
		assert.NotErrorIs(t, err, ErrUserPasswordInvalid())
	})

	t.Run("the caller's own context passes through", func(t *testing.T) {
		t.Parallel()
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		err := pw.Verify(ctx, composed, ctxHasher{})
		assert.ErrorIs(t, err, context.Canceled)
		assert.NotErrorIs(t, err, ErrUserPasswordInvalid())
	})
}
