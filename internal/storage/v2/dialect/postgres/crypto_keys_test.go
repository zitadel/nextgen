//go:build postgres_integration

package postgres

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain/crypto"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// This is a storage-level test for the v2 postgres crypto-key (DEK) statements.
// It follows the same shape as project_test.go: it drives the real database
// through the shared v2 testPool set up in TestMain. DEKs are foreign-keyed to a
// project, so each test creates a throwaway project and relies on the ON DELETE
// CASCADE from projects to clean up its DEKs.

// uniqueKeyID returns a collision-free DEK ID scoped to the running (sub)test.
func uniqueKeyID(t *testing.T) string {
	t.Helper()
	return "dek-" + strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
}

// newTestKey builds a persistable DEK in the given state referencing projectID.
func newTestKey(id, projectID string, state crypto.KeyState) *crypto.EncryptionKey {
	return &crypto.EncryptionKey{
		Id:        id,
		ProjectID: projectID,
		Key:       "this is normally an encrypted key",
		Algorithm: jose.A256GCM,
		State:     state,
		Purpose:   crypto.EncryptionKeyPurposeDEK,
	}
}

// withProject creates a project and registers cleanup, returning its ID.
func withProject(t *testing.T) string {
	t.Helper()
	project := newTestProject(uniqueProjectID(t))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
	require.NoError(t, testPool.CreateProject(t.Context(), project))
	return project.ID
}

func TestCryptoKeyStatements_CreateEncryptionKey(t *testing.T) {
	t.Parallel()

	t.Run("creates dek and created_at is set", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		key := newTestKey(uniqueKeyID(t), projectID, crypto.KeyStateActive)

		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), key))
		assert.False(t, key.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), key.CreatedAt, 5*time.Second)

		stored, err := testPool.GetEncryptionKey(t.Context(), database.Equal(database.Col(crypto.EncryptionKeyFieldProjectID), projectID))
		require.NoError(t, err)
		assert.Equal(t, key.Id, stored.Id)
		assert.Equal(t, projectID, stored.ProjectID)
		assert.Equal(t, key.Key, stored.Key)
		assert.Equal(t, jose.A256GCM, stored.Algorithm)
		assert.EqualValues(t, crypto.KeyStateActive, stored.State)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.Nil(t, stored.ActivatedAt)
		assert.Nil(t, stored.RetiredAt)
	})

	t.Run("duplicate ID returns error", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		dek := newTestKey(uniqueKeyID(t), projectID, crypto.KeyStateActive)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), dek))

		err := testPool.CreateEncryptionKey(t.Context(), newTestKey(dek.Id, projectID, crypto.KeyStateActive))
		assert.Error(t, err)
	})

	t.Run("unknown project returns error", func(t *testing.T) {
		t.Parallel()

		dek := newTestKey(uniqueKeyID(t), uniqueProjectID(t), crypto.KeyStateActive)
		err := testPool.CreateEncryptionKey(t.Context(), dek)
		assert.Error(t, err)
	})

	t.Run("second active dek for the same project is rejected", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), newTestKey(uniqueKeyID(t)+"-a", projectID, crypto.KeyStateActive)))

		// The partial unique index permits only one active DEK per project.
		err := testPool.CreateEncryptionKey(t.Context(), newTestKey(uniqueKeyID(t)+"-b", projectID, crypto.KeyStateActive))
		assert.Error(t, err)
	})
}

func TestCryptoKeyStatements_GetEncryptionKey(t *testing.T) {
	t.Parallel()

	t.Run("returns only filtered result", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)

		expired := newTestKey(uniqueKeyID(t)+"-old", projectID, crypto.KeyStateExpired)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), expired))
		active := newTestKey(uniqueKeyID(t)+"-new", projectID, crypto.KeyStateActive)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), active))

		stored, err := testPool.GetEncryptionKey(t.Context(),
			database.And(
				database.Equal(database.Col(crypto.EncryptionKeyFieldProjectID), projectID),
				database.Equal(database.Col(crypto.EncryptionKeyFieldState), crypto.KeyStateActive),
			))
		require.NoError(t, err)
		assert.Equal(t, active.Id, stored.Id)
		assert.EqualValues(t, crypto.KeyStateActive, stored.State)
	})

	t.Run("no results return no row found error", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		// Only a not-yet-active key exists.
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), newTestKey(uniqueKeyID(t), projectID, crypto.KeyStateNotActiveYet)))

		_, err := testPool.GetEncryptionKey(t.Context(),
			database.And(
				database.Equal(database.Col(crypto.EncryptionKeyFieldProjectID), projectID),
				database.Equal(database.Col(crypto.EncryptionKeyFieldState), crypto.KeyStateActive),
			))
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})

	t.Run("unknown project returns NoRowFoundError", func(t *testing.T) {
		t.Parallel()

		_, err := testPool.GetEncryptionKey(t.Context(), database.Equal(database.Col(crypto.EncryptionKeyFieldProjectID), uniqueProjectID(t)))
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})
}
