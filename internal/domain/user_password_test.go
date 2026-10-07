package domain

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
)

// limitedHasher refuses what it cannot take in full, the way bcrypt does past
// 72 bytes.
type limitedHasher struct{ maxBytes int }

func (h limitedHasher) Hash(password string) (string, error) {
	if len(password) > h.maxBytes {
		return "", crypto.ErrPasswordTooLong
	}
	return "plain$" + password, nil
}

// plainHasher stores the password as its own "hash", so a test can see exactly
// what was hashed.
type plainHasher struct{}

func (plainHasher) Hash(password string) (string, error) {
	return "plain$" + password, nil
}

func (plainHasher) VerifyHash(encoded, password string) error {
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
		hash, err := HashPassword(decomposed, plainHasher{})
		require.NoError(t, err)
		assert.Equal(t, "plain$"+composed, hash)
	})

	t.Run("accepts 64 code points and hashes all of them", func(t *testing.T) {
		t.Parallel()
		// 64 code points but 128 bytes: the limit counts code points.
		password := strings.Repeat("ü", MaxPasswordLength)
		hash, err := HashPassword(password, plainHasher{})
		require.NoError(t, err)
		assert.Equal(t, "plain$"+password, hash, "nothing is truncated")
	})

	t.Run("counts the length after normalization", func(t *testing.T) {
		t.Parallel()
		// 128 code points as typed, 64 once each pair composes.
		password := strings.Repeat("ü", MaxPasswordLength)
		hash, err := HashPassword(password, plainHasher{})
		require.NoError(t, err)
		assert.Equal(t, "plain$"+strings.Repeat("ü", MaxPasswordLength), hash)
	})

	t.Run("rejects more than 64 code points", func(t *testing.T) {
		t.Parallel()
		_, err := HashPassword(strings.Repeat("a", MaxPasswordLength+1), plainHasher{})
		assert.ErrorIs(t, err, ErrUserPasswordTooLong())
	})

	t.Run("rejects what the hashing algorithm cannot take in full", func(t *testing.T) {
		t.Parallel()
		// 64 code points, accepted by the length rule, but 128 bytes.
		_, err := HashPassword(strings.Repeat("ü", MaxPasswordLength), limitedHasher{maxBytes: 72})
		assert.ErrorIs(t, err, ErrUserPasswordTooLong())
	})

	t.Run("rejects an empty password", func(t *testing.T) {
		t.Parallel()
		_, err := HashPassword("", plainHasher{})
		assert.ErrorIs(t, err, ErrUserPasswordEmpty())
	})
}

func TestUserPassword_Verify(t *testing.T) {
	t.Parallel()

	t.Run("either composition matches a normalized hash", func(t *testing.T) {
		t.Parallel()
		hash, err := HashPassword(composed, plainHasher{})
		require.NoError(t, err)
		pw := &UserPassword{EncodedHash: hash}
		assert.NoError(t, pw.Verify(composed, plainHasher{}))
		assert.NoError(t, pw.Verify(decomposed, plainHasher{}))
		assert.ErrorIs(t, pw.Verify("cafe-au-lait", plainHasher{}), ErrUserPasswordInvalid())
	})

	t.Run("applies no length limit", func(t *testing.T) {
		t.Parallel()
		long := strings.Repeat("a", MaxPasswordLength+1)
		pw := &UserPassword{EncodedHash: "plain$" + long}
		assert.NoError(t, pw.Verify(long, plainHasher{}))
	})
}

func TestUserPasswordFailures_NextRetryTime(t *testing.T) {
	last := time.Now().Add(-time.Second)
	tests := []struct {
		name     string
		failures UserPasswordFailures
		want     time.Duration
	}{
		{name: "no failures", failures: UserPasswordFailures{}, want: 0},
		{name: "free failures", failures: UserPasswordFailures{Count: UserPasswordFreeFailures, LastFailedAt: last}, want: 0},
		{name: "first restricted failure", failures: UserPasswordFailures{Count: UserPasswordFreeFailures + 1, LastFailedAt: last}, want: UserPasswordBackoffBase},
		{name: "grows per failure", failures: UserPasswordFailures{Count: UserPasswordFreeFailures + 3, LastFailedAt: last}, want: 3 * UserPasswordBackoffBase},
		{name: "capped", failures: UserPasswordFailures{Count: 1000, LastFailedAt: last}, want: UserPasswordBackoffMax},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.failures.NextRetryTime()
			if tt.want == 0 {
				assert.True(t, got.IsZero(), "got %v", got)
				return
			}
			assert.Equal(t, last.Add(tt.want), got)
		})
	}
}

func TestUserPasswordFailuresSince(t *testing.T) {
	now := time.Now()
	assert.Equal(t, now.Add(-UserPasswordFailureWindow), UserPasswordFailuresSince(now))
}

func TestUserPasswordFailures_CheckRateLimit(t *testing.T) {
	now := time.Now()
	assert.NoError(t, UserPasswordFailures{}.CheckRateLimit())
	assert.NoError(t, UserPasswordFailures{Count: UserPasswordFreeFailures, LastFailedAt: now}.CheckRateLimit(),
		"the free failures hold nothing back")

	restricted := func(lastFailedAt time.Time) UserPasswordFailures {
		return UserPasswordFailures{Count: UserPasswordFreeFailures + 1, LastFailedAt: lastFailedAt}
	}
	assert.ErrorIs(t, restricted(now).CheckRateLimit(), ErrUserPasswordRateLimited())
	assert.ErrorIs(t, restricted(now.Add(-UserPasswordBackoffBase+10*time.Second)).CheckRateLimit(), ErrUserPasswordRateLimited(),
		"still within the wait")
	assert.NoError(t, restricted(now.Add(-UserPasswordBackoffBase)).CheckRateLimit(), "the restriction lifts after the wait")
}
