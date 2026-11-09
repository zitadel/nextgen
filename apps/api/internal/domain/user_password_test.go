package domain

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
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

func (plainHasher) VerifyAndRehash(encoded, password string) (string, error) {
	if encoded != "plain$"+password {
		return "", errors.New("mismatch")
	}
	return "", nil
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
		_, err = pw.Verify(composed, plainHasher{})
		assert.NoError(t, err)
		_, err = pw.Verify(decomposed, plainHasher{})
		assert.NoError(t, err)
		_, err = pw.Verify("cafe-au-lait", plainHasher{})
		assert.ErrorIs(t, err, ErrUserPasswordInvalid())
	})

	t.Run("applies no length limit", func(t *testing.T) {
		t.Parallel()
		long := strings.Repeat("a", MaxPasswordLength+1)
		pw := &UserPassword{EncodedHash: "plain$" + long}
		_, err := pw.Verify(long, plainHasher{})
		assert.NoError(t, err)
	})

	// The password matched in both: the caller stores the new hash or, when
	// none could be written, still lets the sign-in through.
	tests := map[string]struct {
		updated string
		err     error
	}{
		"returns the rehash of an outdated hash":  {updated: "new"},
		"a failed rehash is not a wrong password": {err: fmt.Errorf("%w: too long", crypto.ErrRehashFailed)},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			verifier := cryptomock.NewMockRehashingVerifier(gomock.NewController(t))
			verifier.EXPECT().VerifyAndRehash("old", "secret").Return(tt.updated, tt.err)
			updated, err := (&UserPassword{EncodedHash: "old"}).Verify("secret", verifier)
			assert.Equal(t, tt.updated, updated)
			assert.ErrorIs(t, err, tt.err)
			assert.NotErrorIs(t, err, ErrUserPasswordInvalid())
		})
	}
}
