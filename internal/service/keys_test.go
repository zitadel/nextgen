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
	nextgencrypto "github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	databasev2 "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/oidc/v3/pkg/op"
	"go.uber.org/mock/gomock"
)

func newMockedKeyService(t *testing.T) (
	svc service.KeyService,
	statements *servicemocks.MockAllStatements,
	rootKEKs domain.RootKEKs,
) {
	t.Helper()

	ctrl := gomock.NewController(t)

	pool := servicemocks.NewMockPool(ctrl)
	statements = servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	key, err := rsa.GenerateKey(rand.Reader, 4096)
	require.NoError(t, err)

	prootKEKs, err := domain.NewRootKEKs([]domain.RootKEK{
		domain.NewRootKEK(
			"root-kek",
			*key,
			true,
		),
	})
	require.NoError(t, err)

	svc = service.NewKeyService(service.NewPool(pool), *prootKEKs)
	return svc, statements, *prootKEKs
}

func newActiveDEK(t *testing.T, projectID string, kek op.Crypto) *domain.EncryptionKey {
	t.Helper()
	dek, err := domain.NewDEK(projectID, jose.A256GCM, kek)
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

			dek, err := domain.NewDEK("project-1", jose.A256GCM, kek)
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

func TestKeyService_GetProjectDEKCrypter(t *testing.T) {
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
		gotCrypter, err := svc.GetProjectDEKCrypter(t.Context(), "proj-1")
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
			_, err := svc.GetProjectDEKCrypter(t.Context(), "proj-1")
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
			_, err := svc.GetProjectDEK(t.Context(), "proj-1")
			require.Error(t, err)

			// ASSERT
			var de domain.Error
			require.ErrorAs(t, err, &de)
			assert.ErrorIs(t, de.Parent, sentinel)
		})
	})
}

// newRootKEK builds a root KEK backed by a fresh RSA key. A 2048-bit key keeps
// the test fast while remaining large enough to wrap a 256-bit content key.
func newRootKEK(t *testing.T, id string, useForEncryption bool) domain.RootKEK {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return domain.NewRootKEK(id, *key, useForEncryption)
}

// newMigrationKeyService wires a key service around the given root KEKs.
func newMigrationKeyService(t *testing.T, keks ...domain.RootKEK) (service.KeyService, *servicemocks.MockAllStatements) {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()

	rootKEKs, err := domain.NewRootKEKs(keks)
	require.NoError(t, err)

	return service.NewKeyService(service.NewPool(pool), *rootKEKs), statements
}

// newWrappedDEK returns an encryption key whose material is wrapped by the given
// crypter, together with the raw material for later verification.
func newWrappedDEK(t *testing.T, id string, kek nextgencrypto.Encrypter) (*domain.EncryptionKey, string) {
	t.Helper()

	var raw [32]byte
	_, err := rand.Read(raw[:])
	require.NoError(t, err)

	wrapped, err := kek.Encrypt(string(raw[:]))
	require.NoError(t, err)

	return &domain.EncryptionKey{
		ID:        id,
		Key:       wrapped,
		Algorithm: jose.A256GCM,
		State:     domain.KeyStateActive,
		Purpose:   domain.EncryptionKeyPurposeDEK,
	}, string(raw[:])
}

func listResult(keys ...*domain.EncryptionKey) *databasev2.ListResult[*domain.EncryptionKey] {
	return &databasev2.ListResult[*domain.EncryptionKey]{Items: keys}
}

func TestKeyService_MigrateToLatestRootKEK(t *testing.T) {
	t.Parallel()

	t.Run("re-wraps a key encrypted with an older root kek", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		oldKEK := newRootKEK(t, "old-kek", false)
		newKEK := newRootKEK(t, "new-kek", true)
		svc, statements := newMigrationKeyService(t, oldKEK, newKEK)

		dek, raw := newWrappedDEK(t, "dek-1", &oldKEK)

		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(listResult(dek), nil)

		var migratedKey string
		statements.EXPECT().
			UpdateKey(gomock.Any(), "dek-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _ string, key string) error {
				migratedKey = key
				return nil
			})

		// ACT
		err := svc.MigrateToLatestRootKEK(t.Context())
		require.NoError(t, err)

		// ASSERT: the key is now wrapped by the latest root kek and still
		// decrypts to the original material.
		header, err := domain.DecodeJWEHeader(migratedKey)
		require.NoError(t, err)
		assert.Equal(t, "new-kek", header.KeyID)

		decrypted, err := newKEK.Decrypt(migratedKey)
		require.NoError(t, err)
		assert.Equal(t, raw, decrypted)
	})

	t.Run("skips a key already wrapped by the latest root kek", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		oldKEK := newRootKEK(t, "old-kek", false)
		newKEK := newRootKEK(t, "new-kek", true)
		svc, statements := newMigrationKeyService(t, oldKEK, newKEK)

		dek, _ := newWrappedDEK(t, "dek-1", &newKEK)

		// No UpdateKey call is expected: the mock controller fails the test if
		// one happens.
		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(listResult(dek), nil)

		// ACT + ASSERT
		require.NoError(t, svc.MigrateToLatestRootKEK(t.Context()))
	})

	t.Run("skips a key wrapped by a non-root key", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		newKEK := newRootKEK(t, "new-kek", true)
		svc, statements := newMigrationKeyService(t, newKEK)

		// Wrapped by a DEK crypter, so its kid is not a root kek.
		dekCrypter := op.NewAES256GCMCrypto([32]byte([]byte("MasterkeyNeedsToHave32Characters")), "some-dek-id")
		key, _ := newWrappedDEK(t, "tek-1", dekCrypter)

		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(listResult(key), nil)

		// ACT + ASSERT: no UpdateKey call expected.
		require.NoError(t, svc.MigrateToLatestRootKEK(t.Context()))
	})

	t.Run("migrates keys across paginated results", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		oldKEK := newRootKEK(t, "old-kek", false)
		newKEK := newRootKEK(t, "new-kek", true)
		svc, statements := newMigrationKeyService(t, oldKEK, newKEK)

		dek1, _ := newWrappedDEK(t, "dek-1", &oldKEK)
		dek2, _ := newWrappedDEK(t, "dek-2", &oldKEK)

		// First page carries a cursor so the service fetches a second page.
		gomock.InOrder(
			statements.EXPECT().
				ListEncryptionKeys(gomock.Any(), gomock.Any()).
				Return(&databasev2.ListResult[*domain.EncryptionKey]{
					Items:      []*domain.EncryptionKey{dek1},
					NextCursor: []byte("cursor-1"),
				}, nil),
			statements.EXPECT().
				ListEncryptionKeys(gomock.Any(), gomock.Any()).
				Return(listResult(dek2), nil),
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
		require.NoError(t, svc.MigrateToLatestRootKEK(t.Context()))

		// ASSERT: both keys, across both pages, were re-wrapped by the latest kek.
		require.Len(t, migrated, 2)
		for id, key := range migrated {
			header, err := domain.DecodeJWEHeader(key)
			require.NoErrorf(t, err, "key %s", id)
			assert.Equalf(t, "new-kek", header.KeyID, "key %s", id)
		}
	})

	t.Run("returns an error when listing keys fails", func(t *testing.T) {
		t.Parallel()

		// ARRANGE
		svc, statements := newMigrationKeyService(t, newRootKEK(t, "new-kek", true))
		sentinel := errors.New("connection refused")

		statements.EXPECT().
			ListEncryptionKeys(gomock.Any(), gomock.Any()).
			Return(nil, sentinel)

		// ACT
		err := svc.MigrateToLatestRootKEK(t.Context())

		// ASSERT
		require.Error(t, err)
		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.ErrorIs(t, de.Parent, sentinel)
	})
}
