package domain

import (
	"crypto/ed25519"
	"errors"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"go.uber.org/mock/gomock"
)

func TestNewSigningKey(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}

		projectID := "proj-1"
		key, err := NewSigningKey(projectID, SigningKeyPurposeToken, jose.EdDSA, kek)
		require.NoError(t, err)
		require.NotNil(t, key)

		assert.Empty(t, key.ID, "ID is assigned by the dialect on create")
		assert.Equal(t, projectID, key.ProjectID)
		assert.Equal(t, SigningKeyPurposeToken, key.Purpose)
		assert.Equal(t, jose.EdDSA, key.Algorithm)
		assert.Equal(t, KeyStateNotActiveYet, key.State)

		// Stored encrypted, and what it protects is an Ed25519 seed.
		require.NotEmpty(t, key.Key)
		decrypted, err := kek.Decrypt(key.Key)
		require.NoError(t, err)
		assert.Len(t, []byte(decrypted), ed25519.SeedSize)
		assert.NotEqual(t, make([]byte, ed25519.SeedSize), []byte(decrypted), "generated seed must not be all zeros")
	})

	t.Run("two signing keys get distinct random seeds", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		a, err := NewSigningKey("proj", SigningKeyPurposeToken, jose.EdDSA, kek)
		require.NoError(t, err)
		b, err := NewSigningKey("proj", SigningKeyPurposeToken, jose.EdDSA, kek)
		require.NoError(t, err)
		assert.NotEqual(t, a.Key, b.Key)
		assert.Empty(t, a.ID)
		assert.Empty(t, b.ID)
	})

	t.Run("encrypt error is propagated", func(t *testing.T) {
		sentinel := errors.New("boom")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Encrypt(gomock.Any()).Return("", sentinel)

		_, err := NewSigningKey("proj", SigningKeyPurposeToken, jose.EdDSA, kek)
		require.Error(t, err)
		var de Error
		require.ErrorAs(t, err, &de)
		assert.ErrorIs(t, de.Parent, sentinel)
	})
}

func TestSigningKey_Signer(t *testing.T) {
	t.Run("signs and verifies against the derived public key", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}

		key, err := NewSigningKey("proj", SigningKeyPurposeToken, jose.EdDSA, kek)
		require.NoError(t, err)

		signer, err := key.Signer(kek)
		require.NoError(t, err)

		payload := []byte(`{"sub":"user-1"}`)
		jws, err := signer.Sign(payload)
		require.NoError(t, err)

		serialized, err := jws.CompactSerialize()
		require.NoError(t, err)

		// Verify with the public half of the stored seed.
		seed, err := kek.Decrypt(key.Key)
		require.NoError(t, err)
		public := ed25519.NewKeyFromSeed([]byte(seed)).Public()

		parsed, err := jose.ParseSigned(serialized, []jose.SignatureAlgorithm{jose.EdDSA})
		require.NoError(t, err)
		verified, err := parsed.Verify(public)
		require.NoError(t, err)
		assert.Equal(t, payload, verified)
	})

	t.Run("carries the key id into the JWS header", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}

		key, err := NewSigningKey("proj", SigningKeyPurposeToken, jose.EdDSA, kek)
		require.NoError(t, err)
		key.ID = "sig_key_test"

		signer, err := key.Signer(kek)
		require.NoError(t, err)

		jws, err := signer.Sign([]byte("payload"))
		require.NoError(t, err)
		serialized, err := jws.CompactSerialize()
		require.NoError(t, err)

		// Read it back the way a verifier does: the kid lives in the protected
		// header, which is only populated on the parsed object.
		parsed, err := jose.ParseSigned(serialized, []jose.SignatureAlgorithm{jose.EdDSA})
		require.NoError(t, err)
		require.Len(t, parsed.Signatures, 1)
		assert.Equal(t, key.ID, parsed.Signatures[0].Header.KeyID)
	})

	t.Run("decrypt error", func(t *testing.T) {
		sentinel := errors.New("no can do")
		kek := cryptomock.NewMockCrypter(gomock.NewController(t))
		kek.EXPECT().Decrypt(gomock.Any()).Return("", sentinel)

		key := &SigningKey{Key: "whatever", Algorithm: jose.EdDSA}
		_, err := key.Signer(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrDecryptionFailed(nil).Code)
	})

	t.Run("seed of the wrong length is rejected", func(t *testing.T) {
		kek := &crypto.InverseCrypter{}
		encrypted, err := kek.Encrypt("too short")
		require.NoError(t, err)

		key := &SigningKey{Key: encrypted, Algorithm: jose.EdDSA}
		_, err = key.Signer(kek)
		require.Error(t, err)
		assertDomainErrorCode(t, err, ErrDecryptionFailed(nil).Code)
	})
}

func TestSigningKey_Activate(t *testing.T) {
	t.Run("no current key", func(t *testing.T) {
		k := &SigningKey{State: KeyStateNotActiveYet}
		k.Activate(nil)

		assert.Equal(t, KeyStateActive, k.State)
		require.NotNil(t, k.ActivatedAt)
		assert.True(t, k.IsActive())
	})

	t.Run("expires the current key", func(t *testing.T) {
		current := &SigningKey{State: KeyStateActive}
		k := &SigningKey{State: KeyStateNotActiveYet}

		k.Activate(current)

		assert.Equal(t, KeyStateExpired, current.State)
		require.NotNil(t, current.RetiredAt)
		assert.False(t, current.IsActive())
		assert.Equal(t, KeyStateActive, k.State)
		require.NotNil(t, k.ActivatedAt)
	})
}
