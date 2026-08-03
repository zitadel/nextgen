package service_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/op"
	"go.uber.org/mock/gomock"

	nextgencrypto "github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func newMockedKeyService(t *testing.T) (
	svc service.KeyService,
	statements *servicemocks.MockAllStatements,
	masterKeys domain.MasterKeys,
) {
	t.Helper()

	ctrl := gomock.NewController(t)

	pool := servicemocks.NewMockPool(ctrl)
	statements = servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pmasterKeys, err := domain.NewMasterKeys([]domain.MasterKey{
		domain.NewMasterKey(
			"master-key",
			*key,
			true,
		),
	})
	require.NoError(t, err)

	svc = service.NewKeyService(service.NewPool(pool), *pmasterKeys)
	return svc, statements, *pmasterKeys
}

func newActiveKEK(t *testing.T, projectID string, masterKey op.Crypto) *domain.EncryptionKey {
	t.Helper()
	kek, err := domain.NewEncryptionKey(projectID, domain.EncryptionKeyPurposeKEK, jose.A256GCM, masterKey)
	require.NoError(t, err)
	kek.ID = "encryption_key_test"
	kek.Activate(nil)
	return kek
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

		t.Run("project kek (wrapped by the master key)", func(t *testing.T) {
			t.Parallel()

			// ARRANGE
			svc, statements, masterKey := newMockedKeyService(t)

			kek, err := domain.NewEncryptionKey("project-1", domain.EncryptionKeyPurposeKEK, jose.A256GCM, masterKey)
			require.NoError(t, err)
			kek.ID = "encryption_key_test"
			kekCrypter, err := kek.Crypter(masterKey)
			require.NoError(t, err)

			const payload = "secret-payload"
			encrypted, err := kekCrypter.Encrypt(payload)
			require.NoError(t, err)

			statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(kek, nil)

			// ACT
			got, err := svc.GetCrypter(t.Context(), kek.ID, kek.Algorithm)
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
			svc, statements, masterKey := newMockedKeyService(t)

			kek := newActiveKEK(t, "proj-1", masterKey)
			kekCrypter, err := kek.Crypter(masterKey)
			require.NoError(t, err)

			tokenKey := newTokenEncryptionKey(t, "tek_child_1", "proj-1", kekCrypter)
			tokenKeyCrypter, err := tokenKey.Crypter(kekCrypter)
			require.NoError(t, err)

			const payload = "secret-payload"
			encrypted, err := tokenKeyCrypter.Encrypt(payload)
			require.NoError(t, err)

			gomock.InOrder(
				statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(tokenKey, nil),
				statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(kek, nil),
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
				Return(nil, database.NewNoRowFoundError(nil))

			// ACT
			_, err := svc.GetEncryptionKey(t.Context(), "enc_key_missing", jose.A256GCM)
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
		svc, statements, masterKey := newMockedKeyService(t)

		kek := newActiveKEK(t, "proj-1", masterKey)
		kekCrypter, err := kek.Crypter(masterKey)
		require.NoError(t, err)
		require.NotNil(t, kekCrypter)

		const payload = "secret-payload"
		encrypted, err := kekCrypter.Encrypt(payload)
		require.NoError(t, err)

		statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(kek, nil)

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
				Return(nil, database.NewNoRowFoundError(nil))

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

// newMasterKey builds a master key backed by a fresh RSA key. A 2048-bit key keeps
// the test fast while remaining large enough to wrap a 256-bit content key.
func newMasterKey(t *testing.T, id string, useForEncryption bool) domain.MasterKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return domain.NewMasterKey(id, *key, useForEncryption)
}

// newMigrationKeyService wires a key service around the given master keys.
func newMigrationKeyService(t *testing.T, masterKeys ...domain.MasterKey) (service.KeyService, *servicemocks.MockAllStatements) {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()

	allMasterKeys, err := domain.NewMasterKeys(masterKeys)
	require.NoError(t, err)

	return service.NewKeyService(service.NewPool(pool), *allMasterKeys), statements
}

// newWrappedKEK returns a project KEK whose material is wrapped by the given
// crypter, together with the raw material for later verification.
func newWrappedKEK(t *testing.T, id string, masterKey nextgencrypto.Encrypter) (*domain.EncryptionKey, string) {
	t.Helper()

	var raw [32]byte
	_, err := rand.Read(raw[:])
	require.NoError(t, err)

	wrapped, err := masterKey.Encrypt(string(raw[:]))
	require.NoError(t, err)

	return &domain.EncryptionKey{
		ID:        id,
		Key:       wrapped,
		Algorithm: jose.A256GCM,
		State:     domain.KeyStateActive,
		Purpose:   domain.EncryptionKeyPurposeKEK,
	}, string(raw[:])
}

func listResult(keys ...*domain.EncryptionKey) *database.ListResult[*domain.EncryptionKey] {
	return &database.ListResult[*domain.EncryptionKey]{Items: keys}
}

func TestKeyService_MigrateToLatestMasterKey(t *testing.T) {
	t.Parallel()

	t.Run("re-wraps a key encrypted with an older master key", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		oldMasterKey := newMasterKey(t, "old-master-key", false)
		newMasterKey := newMasterKey(t, "new-master-key", true)
		svc, statements := newMigrationKeyService(t, oldMasterKey, newMasterKey)

		kek, raw := newWrappedKEK(t, "project-kek-1", &oldMasterKey)

		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(listResult(kek), nil)

		var migratedKey string
		statements.EXPECT().
			UpdateKey(gomock.Any(), "project-kek-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _ string, key string) error {
				migratedKey = key
				return nil
			})

		// ACT
		err := svc.MigrateToLatestMasterKey(t.Context())
		require.NoError(t, err)

		// ASSERT: the key is now wrapped by the latest master key and still
		// decrypts to the original material.
		header, err := domain.DecodeJWEHeader(migratedKey)
		require.NoError(t, err)
		assert.Equal(t, "new-master-key", header.KeyID)

		decrypted, err := newMasterKey.Decrypt(migratedKey)
		require.NoError(t, err)
		assert.Equal(t, raw, decrypted)
	})

	t.Run("skips a key already wrapped by the latest master key", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		oldMasterKey := newMasterKey(t, "old-master-key", false)
		newMasterKey := newMasterKey(t, "new-master-key", true)
		svc, statements := newMigrationKeyService(t, oldMasterKey, newMasterKey)

		kek, _ := newWrappedKEK(t, "kek-1", &newMasterKey)

		// No UpdateKey call is expected: the mock controller fails the test if
		// one happens.
		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(listResult(kek), nil)

		// ACT + ASSERT
		require.NoError(t, svc.MigrateToLatestMasterKey(t.Context()))
	})

	t.Run("skips a key wrapped by a project kek", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		newMasterKey := newMasterKey(t, "new-master-key", true)
		svc, statements := newMigrationKeyService(t, newMasterKey)

		// Wrapped by a project KEK crypter, so its kid is not a master key.
		kekCrypter := op.NewAES256GCMCrypto([32]byte([]byte("MasterkeyNeedsToHave32Characters")), "some-kek-id")
		key, _ := newWrappedKEK(t, "tek-1", kekCrypter)

		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(listResult(key), nil)

		// ACT + ASSERT: no UpdateKey call expected.
		require.NoError(t, svc.MigrateToLatestMasterKey(t.Context()))
	})

	t.Run("migrates keys across paginated results", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		oldMasterKey := newMasterKey(t, "old-master-key", false)
		newMasterKey := newMasterKey(t, "new-master-key", true)
		svc, statements := newMigrationKeyService(t, oldMasterKey, newMasterKey)

		kek1, _ := newWrappedKEK(t, "kek-1", &oldMasterKey)
		kek2, _ := newWrappedKEK(t, "kek-2", &oldMasterKey)

		// First page carries a cursor so the service fetches a second page.
		gomock.InOrder(
			statements.EXPECT().
				ListEncryptionKeys(gomock.Any(), gomock.Any()).
				Return(&database.ListResult[*domain.EncryptionKey]{
					Items:      []*domain.EncryptionKey{kek1},
					NextCursor: []byte("cursor-1"),
				}, nil),
			statements.EXPECT().
				ListEncryptionKeys(gomock.Any(), gomock.Any()).
				Return(listResult(kek2), nil),
		)

		migrated := make(map[string]string)
		statements.EXPECT().
			UpdateKey(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, id string, key string) error {
				migrated[id] = key
				return nil
			}).
			Times(2)

		// ACT
		require.NoError(t, svc.MigrateToLatestMasterKey(t.Context()))

		// ASSERT: both keys, across both pages, were re-wrapped by the latest kek.
		require.Len(t, migrated, 2)
		for id, key := range migrated {
			header, err := domain.DecodeJWEHeader(key)
			require.NoErrorf(t, err, "key %s", id)
			assert.Equalf(t, "new-master-key", header.KeyID, "key %s", id)
		}
	})

	t.Run("returns an error when listing keys fails", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		svc, statements := newMigrationKeyService(t, newMasterKey(t, "new-master-key", true))
		sentinel := errors.New("connection refused")

		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(nil, sentinel)

		// ACT
		err := svc.MigrateToLatestMasterKey(t.Context())

		// ASSERT
		require.Error(t, err)
		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.ErrorIs(t, de.Parent, sentinel)
	})
}
