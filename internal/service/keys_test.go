package service_test

import (
	"crypto/rand"
	"errors"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nextgencrypto "github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/oidc/v3/pkg/op"
	"go.uber.org/mock/gomock"
)

func newMockedKeyService(t *testing.T) (
	svc service.KeyService,
	statements *servicemocks.MockAllStatements,
	kek op.Crypto,
) {
	t.Helper()

	ctrl := gomock.NewController(t)

	pool := servicemocks.NewMockPool(ctrl)
	statements = servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	kek = op.NewAES256GCMCrypto([32]byte([]byte("MasterkeyNeedsToHave32Characters")), "")

	svc = service.NewKeyService(service.NewPool(pool), kek)
	return svc, statements, kek
}

func newActiveDEK(t *testing.T, projectID string, kek op.Crypto) *domain.EncryptionKey {
	t.Helper()
	dek, err := domain.NewEncryptionKey(projectID, domain.EncryptionKeyPurposeDEK, jose.A256GCM, kek)
	require.NoError(t, err)
	dek.Activate(nil)
	return dek
}

func newTokenEncryptionKey(t *testing.T, id, projectID string, encrypter nextgencrypto.Encrypter) *domain.EncryptionKey {
	t.Helper()
	var raw [32]byte
	_, err := rand.Read(raw[:])
	require.NoError(t, err)
	encryptedKey, err := encrypter.Encrypt(string(raw[:]))
	require.NoError(t, err)
	return &domain.EncryptionKey{
		ID:        id,
		ProjectID: projectID,
		Key:       encryptedKey,
		Algorithm: jose.A256GCM,
		State:     domain.KeyStateActive,
		Purpose:   "token encryption", // TODO: using a free text purpose now, but this needs to change in the future
	}
}

func TestKeyService_GetCrypter(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		t.Run("dek (direct kek)", func(t *testing.T) {
			t.Parallel()

			// ARRANGE
			svc, statements, kek := newMockedKeyService(t)

			dek, err := domain.NewEncryptionKey("project-1", domain.EncryptionKeyPurposeDEK, jose.A256GCM, kek)
			require.NoError(t, err)
			dekCrypter, err := dek.Crypter(kek)
			require.NoError(t, err)

			const payload = "secret-payload"
			encrypted, err := dekCrypter.Encrypt(payload)
			require.NoError(t, err)

			statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(dek, nil)

			// ACT
			got, err := svc.GetCrypter(t.Context(), dek.ID, dek.Algorithm)
			require.NoError(t, err)
			require.NotNil(t, got)

			// ASSERT
			decrypted, err := got.Decrypt(encrypted)
			assert.NoError(t, err)
			assert.Equal(t, payload, decrypted, "the key received from the service should be able to decrypt the initial payload")
		})

		t.Run("token encryption key (recursive)", func(t *testing.T) {
			t.Parallel()

			// ARRANGE
			svc, statements, kek := newMockedKeyService(t)

			dek := newActiveDEK(t, "proj-1", kek)
			dekCrypter, err := dek.Crypter(kek)
			require.NoError(t, err)

			tokenKey := newTokenEncryptionKey(t, "tek_child_1", "proj-1", dekCrypter)
			tokenKeyCrypter, err := tokenKey.Crypter(dekCrypter)
			require.NoError(t, err)

			const payload = "secret-payload"
			encrypted, err := tokenKeyCrypter.Encrypt(payload)
			require.NoError(t, err)

			gomock.InOrder(
				statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(tokenKey, nil),
				statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(dek, nil),
			)

			// ACT
			crypter, err := svc.GetCrypter(t.Context(), tokenKey.ID, jose.A256GCM)
			require.NoError(t, err)
			require.NotNil(t, crypter)

			// ASSERT
			decrypted, err := crypter.Decrypt(encrypted)
			require.NoError(t, err)
			assert.Equal(t, payload, decrypted, "the key received from the service should be able to decrypt the initial payload")
		})
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("not found", func(t *testing.T) {
			t.Parallel()

			// ARRANGE
			svc, statements, _ := newMockedKeyService(t)
			statements.EXPECT().
				GetEncryptionKey(gomock.Any(), gomock.Any()).
				Return(nil, storagedb.NewNoRowFoundError(nil))

			// ACT
			_, err := svc.GetEncryptionKey(t.Context(), "dek_missing", jose.A256GCM)
			require.Error(t, err)

			// ASSERT
			var de domain.Error
			require.ErrorAs(t, err, &de)
			assert.Equal(t, domain.ErrEncryptionKeyNotFound().Code, de.Code)
		})
	})
}

func TestKeyService_GetProjectCrypter(t *testing.T) {
	t.Parallel()
	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		svc, statements, kek := newMockedKeyService(t)

		dek := newActiveDEK(t, "proj-1", kek)
		dekCrypter, err := dek.Crypter(kek)
		require.NoError(t, err)
		require.NotNil(t, dekCrypter)

		const payload = "secret-payload"
		encrypted, err := dekCrypter.Encrypt(payload)
		require.NoError(t, err)

		statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(dek, nil)

		// ACT
		gotCrypter, err := svc.GetProjectCrypter(t.Context(), "proj-1", domain.EncryptionKeyPurposeToken)
		require.NoError(t, err)
		require.NotNil(t, gotCrypter)

		// ASSERT
		decrypted, err := gotCrypter.Decrypt(encrypted)
		assert.Equal(t, payload, decrypted)
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("not found", func(t *testing.T) {
			t.Parallel()

			// ARRANGE
			svc, statements, _ := newMockedKeyService(t)

			statements.EXPECT().
				GetEncryptionKey(gomock.Any(), gomock.Any()).
				Return(nil, storagedb.NewNoRowFoundError(nil))

			// ACT
			_, err := svc.GetProjectCrypter(t.Context(), "proj-1", domain.EncryptionKeyPurposeToken)
			require.Error(t, err)

			// ASSERT
			var de domain.Error
			require.ErrorAs(t, err, &de)
			assert.Equal(t, domain.ErrEncryptionKeyNotFound().Code, de.Code)
		})

		t.Run("internal", func(t *testing.T) {
			t.Parallel()

			// ARRANGE
			svc, statements, _ := newMockedKeyService(t)
			sentinel := errors.New("connection refused")

			statements.EXPECT().
				GetEncryptionKey(gomock.Any(), gomock.Any()).
				Return(nil, sentinel)

			// ACT
			_, err := svc.GetProjectEncryptionKey(t.Context(), "proj-1", domain.EncryptionKeyPurposeToken)
			require.Error(t, err)

			// ASSERT
			var de domain.Error
			require.ErrorAs(t, err, &de)
			assert.ErrorIs(t, de.Parent, sentinel)
		})
	})
}
