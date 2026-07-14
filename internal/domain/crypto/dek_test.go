package crypto

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"go.uber.org/mock/gomock"
)

// assertDomainErrorCode extracts the domain.Error from err and asserts its Code.
// We compare Code rather than using errors.Is because some domain errors carry
// a map in Details, which makes the errors.Is fast-path (==) panic, and
// domain.Error does not implement Unwrap.
func assertDomainErrorCode(t *testing.T, err error, want string) {
	t.Helper()
	var de domain.Error
	require.ErrorAs(t, err, &de)
	assert.Equal(t, want, de.Code)
}

func TestNewDEK(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}

		projectID := "proj-1"
		alg := DEKAlgorithmAESGCM

		dek, err := NewDEK(projectID, alg, kek)
		require.NoError(t, err)
		require.NotNil(t, dek)

		assert.NotEmpty(t, dek.Id)
		assert.Equal(t, projectID, dek.ProjectID)
		assert.Equal(t, alg, dek.Algorithm)
		assert.Equal(t, KeyStateNotActiveYet, dek.State)

		// Key is stored encrypted: it is not empty and decrypts back to a
		// full 32-byte random key.
		require.NotEmpty(t, dek.Key)
		decrypted, err := kek.Decrypt(string(dek.Key))
		require.NoError(t, err)
		assert.Len(t, []byte(decrypted), 32, "the length of an AES key must be 32 bytes")
		assert.NotEqual(t, make([]byte, 32), []byte(decrypted), "generated key must not be all zeros")
	})

	t.Run("two DEKs get distinct random keys", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		a, err := NewDEK("proj", DEKAlgorithmAESGCM, kek)
		require.NoError(t, err)
		b, err := NewDEK("proj", DEKAlgorithmAESGCM, kek)
		require.NoError(t, err)
		assert.NotEqual(t, a.Key, b.Key)
		assert.NotEqual(t, a.Id, b.Id)
	})

	t.Run("encrypt error is propagated", func(t *testing.T) {
		sentinel := errors.New("boom")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Encrypt(gomock.Any()).Return("", sentinel)

		_, err := NewDEK("proj", DEKAlgorithmAESGCM, kek)
		require.Error(t, err)
		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.ErrorIs(t, de.Parent, sentinel)
	})
}

func TestDEK_Activate(t *testing.T) {
	t.Run("no current key", func(t *testing.T) {
		k := &DEK{State: KeyStateNotActiveYet}
		k.Activate(nil)

		assert.Equal(t, KeyState(KeyStateActive), k.State)
		require.NotNil(t, k.ActivatedAt)
	})

	t.Run("expires the current key", func(t *testing.T) {
		current := &DEK{State: KeyStateActive}
		k := &DEK{State: KeyStateNotActiveYet}

		k.Activate(current)

		assert.Equal(t, KeyState(KeyStateExpired), current.State)
		require.NotNil(t, current.RetiredAt)
		assert.Equal(t, KeyState(KeyStateActive), k.State)
		require.NotNil(t, k.ActivatedAt)
	})
}

func TestDEK_Expire(t *testing.T) {
	t.Run("nil replacement", func(t *testing.T) {
		k := &DEK{State: KeyStateActive}
		err := k.Expire(nil)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrNoReplacementDEK().Code)
	})

	t.Run("with replacement", func(t *testing.T) {
		replacement := &DEK{State: KeyStateActive}
		k := &DEK{State: KeyStateNotActiveYet}

		err := k.Expire(replacement)
		require.NoError(t, err)

		assert.Equal(t, KeyState(KeyStateExpired), replacement.State)
		require.NotNil(t, replacement.RetiredAt)
		assert.Equal(t, KeyState(KeyStateActive), k.State)
		require.NotNil(t, k.ActivatedAt)
		assert.Equal(t, *replacement.RetiredAt, *k.ActivatedAt)
	})
}

func TestDEK_Remove(t *testing.T) {
	t.Run("nil replacement", func(t *testing.T) {
		k := &DEK{State: KeyStateActive}
		err := k.Remove(nil)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrNoReplacementDEK().Code)
	})

	t.Run("with replacement", func(t *testing.T) {
		replacement := &DEK{State: KeyStateActive}
		k := &DEK{State: KeyStateNotActiveYet}

		err := k.Remove(replacement)
		require.NoError(t, err)

		assert.Equal(t, KeyState(KeyStateRemoved), replacement.State)
		require.NotNil(t, replacement.RetiredAt)
		assert.Equal(t, KeyState(KeyStateActive), k.State)
		require.NotNil(t, k.ActivatedAt)
	})
}

func TestDEK_DecryptedKey(t *testing.T) {
	t.Run("round trips the stored key", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		want := "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
		encrypted, err := kek.Encrypt(want)
		require.NoError(t, err)

		k := &DEK{Key: []byte(encrypted)}

		got, err := k.DecryptedKey(kek)
		require.NoError(t, err)
		assert.Equal(t, want, string(got[:]))
	})

	t.Run("decrypt error", func(t *testing.T) {
		sentinel := errors.New("no can do")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Decrypt(gomock.Any()).Return("", sentinel)

		k := &DEK{Key: []byte("whatever")}
		got, err := k.DecryptedKey(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrDecryptionFailed(nil).Code)
		assert.Equal(t, [32]byte{}, got)
	})
}

func TestDEK_Crypter(t *testing.T) {
	t.Run("AES-GCM round trip", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		key := "abcdefghijklmnopqrstuvwxyz012345"
		encrypted, err := kek.Encrypt(key)
		require.NoError(t, err)

		dek := &DEK{Id: "dek_1", Key: []byte(encrypted), Algorithm: DEKAlgorithmAESGCM}
		crypter, err := dek.Crypter(kek)
		require.NoError(t, err)
		require.NotNil(t, crypter)

		// The returned crypter must be usable end-to-end.
		ciphertext, err := crypter.Encrypt("super-secret")
		require.NoError(t, err)
		plaintext, err := crypter.Decrypt(ciphertext)
		require.NoError(t, err)
		assert.Equal(t, "super-secret", plaintext)
	})

	t.Run("unknown algorithm", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		key := "abcdefghijklmnopqrstuvwxyz012345"
		encrypted, err := kek.Encrypt(key)
		require.NoError(t, err)

		dek := &DEK{Key: []byte(encrypted), Algorithm: "rot13"}
		_, err = dek.Crypter(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrUnknownDEKAlgorithm("rot13").Code)
	})

	t.Run("decrypt error is propagated", func(t *testing.T) {
		sentinel := errors.New("kek unavailable")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Decrypt(gomock.Any()).Return("", sentinel)

		dek := &DEK{Key: []byte("x"), Algorithm: DEKAlgorithmAESGCM}
		_, err := dek.Crypter(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrDecryptionFailed(nil).Code)
	})
}
