package domain

import (
	"errors"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"go.uber.org/mock/gomock"
)

// assertDomainErrorCode extracts the domain.Error from err and asserts its Code.
// We compare Code rather than using errors.Is because some domain errors carry
// a map in Details, which makes the errors.Is fast-path (==) panic, and
// domain.Error does not implement Unwrap.
func assertDomainErrorCode(t *testing.T, err error, want string) {
	t.Helper()
	var de Error
	require.ErrorAs(t, err, &de)
	assert.Equal(t, want, de.Code)
}

func TestNewEncryptionKey(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}

		projectID := "proj-1"
		alg := jose.A256GCM

		key, err := NewEncryptionKey(projectID, EncryptionKeyPurposeKEK, alg, kek)
		require.NoError(t, err)
		require.NotNil(t, key)

		assert.Empty(t, key.ID, "ID is assigned by the dialect on create")
		assert.Equal(t, projectID, key.ProjectID)
		assert.Equal(t, alg, key.Algorithm)
		assert.Equal(t, KeyStateNotActiveYet, key.State)

		// Key is stored encrypted: it is not empty and decrypts back to a
		// full 32-byte random key.
		require.NotEmpty(t, key.Key)
		decrypted, err := kek.Decrypt(string(key.Key))
		require.NoError(t, err)
		assert.Len(t, []byte(decrypted), 32, "the length of an AES key must be 32 bytes")
		assert.NotEqual(t, make([]byte, 32), []byte(decrypted), "generated key must not be all zeros")
	})

	t.Run("two keys get distinct random keys", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		a, err := NewEncryptionKey("proj", EncryptionKeyPurposeKEK, jose.A256GCM, kek)
		require.NoError(t, err)
		b, err := NewEncryptionKey("proj", EncryptionKeyPurposeKEK, jose.A256GCM, kek)
		require.NoError(t, err)
		assert.NotEqual(t, a.Key, b.Key)
		assert.Empty(t, a.ID)
		assert.Empty(t, b.ID)
	})

	t.Run("encrypt error is propagated", func(t *testing.T) {
		sentinel := errors.New("boom")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Encrypt(gomock.Any()).Return("", sentinel)

		_, err := NewEncryptionKey("proj", EncryptionKeyPurposeKEK, jose.A256GCM, kek)
		require.Error(t, err)
		var de Error
		require.ErrorAs(t, err, &de)
		assert.ErrorIs(t, de.Parent, sentinel)
	})
}

func TestEncryptionKey_Activate(t *testing.T) {
	t.Run("no current key", func(t *testing.T) {
		k := &EncryptionKey{State: KeyStateNotActiveYet}
		k.Activate(nil)

		assert.Equal(t, KeyState(KeyStateActive), k.State)
		require.NotNil(t, k.ActivatedAt)
	})

	t.Run("expires the current key", func(t *testing.T) {
		current := &EncryptionKey{State: KeyStateActive}
		k := &EncryptionKey{State: KeyStateNotActiveYet}

		k.Activate(current)

		assert.Equal(t, KeyState(KeyStateExpired), current.State)
		require.NotNil(t, current.RetiredAt)
		assert.Equal(t, KeyState(KeyStateActive), k.State)
		require.NotNil(t, k.ActivatedAt)
	})
}

func TestEncryptionKey_DecryptedKey(t *testing.T) {
	t.Run("round trips the stored key", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		want := "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
		encrypted, err := kek.Encrypt(want)
		require.NoError(t, err)

		k := &EncryptionKey{Key: encrypted}

		got, err := k.DecryptedKey(kek)
		require.NoError(t, err)
		assert.Equal(t, want, string(got[:]))
	})

	t.Run("decrypt error", func(t *testing.T) {
		sentinel := errors.New("no can do")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Decrypt(gomock.Any()).Return("", sentinel)

		k := &EncryptionKey{Key: "whatever"}
		got, err := k.DecryptedKey(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrDecryptionFailed(nil).Code)
		assert.Equal(t, [32]byte{}, got)
	})
}

func TestEncryptionKey_Crypter(t *testing.T) {
	t.Run("AES-GCM round trip", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		key := "abcdefghijklmnopqrstuvwxyz012345"
		encrypted, err := kek.Encrypt(key)
		require.NoError(t, err)

		encKey := &EncryptionKey{ID: "enc_key_1", Key: encrypted, Algorithm: jose.A256GCM}
		crypter, err := encKey.Crypter(kek)
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

		encKey := &EncryptionKey{Key: encrypted, Algorithm: "rot13"}
		_, err = encKey.Crypter(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrSupportedEncryptionAlgorithm("rot13").Code)
	})

	t.Run("decrypt error is propagated", func(t *testing.T) {
		sentinel := errors.New("kek unavailable")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Decrypt(gomock.Any()).Return("", sentinel)

		encKey := &EncryptionKey{Key: "x", Algorithm: jose.A256GCM}
		_, err := encKey.Crypter(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrDecryptionFailed(nil).Code)
	})
}
