//go:build postgres_integration

package postgres

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain/crypto"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
)

// This is a storage-level test for the v2 postgres crypto-key (DEK) statements.
// It follows the same shape as project_test.go: it drives the real database
// through the shared v2 testPool set up in TestMain. DEKs are foreign-keyed to a
// project, so each test creates a throwaway project and relies on the ON DELETE
// CASCADE from projects to clean up its DEKs.

// uniqueDEKID returns a collision-free DEK ID scoped to the running (sub)test.
func uniqueDEKID(t *testing.T) string {
	t.Helper()
	return "dek-" + strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
}

// testKey is a deterministic 32-byte key. The bytes span 0x00..0x1f to prove the
// value round-trips through the BYTEA column untouched.
func testKey() []byte {
	k := make([]byte, 32)
	for i := range k {
		k[i] = byte(i)
	}
	return k
}

// newTestDEK builds a persistable DEK in the given state referencing projectID.
func newTestDEK(id, projectID string, state crypto.KeyState) *crypto.DEK {
	return &crypto.DEK{
		Id:        id,
		ProjectID: projectID,
		Key:       testKey(),
		Algorithm: crypto.DEKAlgorithmAESGCM,
		State:     state,
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

func TestCryptoKeyStatements_CreateDEK(t *testing.T) {
	t.Run("creates dek and created_at is set", func(t *testing.T) {
		projectID := withProject(t)
		dek := newTestDEK(uniqueDEKID(t), projectID, crypto.KeyStateActive)

		require.NoError(t, testPool.CreateDEK(t.Context(), dek))
		assert.False(t, dek.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), dek.CreatedAt, 5*time.Second)

		stored, err := testPool.GetActiveDEK(t.Context(), projectID)
		require.NoError(t, err)
		assert.Equal(t, dek.Id, stored.Id)
		assert.Equal(t, projectID, stored.ProjectID)
		assert.Equal(t, testKey(), stored.Key)
		assert.Equal(t, crypto.DEKAlgorithmAESGCM, stored.Algorithm)
		assert.EqualValues(t, crypto.KeyStateActive, stored.State)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.Nil(t, stored.ActivatedAt)
		assert.Nil(t, stored.RetiredAt)
	})

	t.Run("duplicate ID returns error", func(t *testing.T) {
		projectID := withProject(t)
		dek := newTestDEK(uniqueDEKID(t), projectID, crypto.KeyStateActive)
		require.NoError(t, testPool.CreateDEK(t.Context(), dek))

		err := testPool.CreateDEK(t.Context(), newTestDEK(dek.Id, projectID, crypto.KeyStateActive))
		assert.Error(t, err)
	})

	t.Run("unknown project returns error", func(t *testing.T) {
		dek := newTestDEK(uniqueDEKID(t), uniqueProjectID(t), crypto.KeyStateActive)
		err := testPool.CreateDEK(t.Context(), dek)
		assert.Error(t, err)
	})

	t.Run("second active dek for the same project is rejected", func(t *testing.T) {
		projectID := withProject(t)
		require.NoError(t, testPool.CreateDEK(t.Context(), newTestDEK(uniqueDEKID(t)+"-a", projectID, crypto.KeyStateActive)))

		// The partial unique index permits only one active DEK per project.
		err := testPool.CreateDEK(t.Context(), newTestDEK(uniqueDEKID(t)+"-b", projectID, crypto.KeyStateActive))
		assert.Error(t, err)
	})
}

func TestCryptoKeyStatements_GetActiveDEK(t *testing.T) {
	t.Run("returns only the active dek", func(t *testing.T) {
		projectID := withProject(t)

		expired := newTestDEK(uniqueDEKID(t)+"-old", projectID, crypto.KeyStateExpired)
		require.NoError(t, testPool.CreateDEK(t.Context(), expired))
		active := newTestDEK(uniqueDEKID(t)+"-new", projectID, crypto.KeyStateActive)
		require.NoError(t, testPool.CreateDEK(t.Context(), active))

		stored, err := testPool.GetActiveDEK(t.Context(), projectID)
		require.NoError(t, err)
		assert.Equal(t, active.Id, stored.Id)
		assert.EqualValues(t, crypto.KeyStateActive, stored.State)
	})

	t.Run("no active dek returns NoRowFoundError", func(t *testing.T) {
		projectID := withProject(t)
		// Only a not-yet-active key exists.
		require.NoError(t, testPool.CreateDEK(t.Context(), newTestDEK(uniqueDEKID(t), projectID, crypto.KeyStateNotActiveYet)))

		_, err := testPool.GetActiveDEK(t.Context(), projectID)
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})

	t.Run("unknown project returns NoRowFoundError", func(t *testing.T) {
		_, err := testPool.GetActiveDEK(t.Context(), uniqueProjectID(t))
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})
}

func TestCryptoKeyStatements_UpdateDEK(t *testing.T) {
	t.Run("persists state transition", func(t *testing.T) {
		projectID := withProject(t)
		dek := newTestDEK(uniqueDEKID(t), projectID, crypto.KeyStateActive)
		require.NoError(t, testPool.CreateDEK(t.Context(), dek))

		// Retire the key: flip state and stamp retired_at.
		retiredAt := time.Now().UTC().Truncate(time.Millisecond)
		dek.State = crypto.KeyStateExpired
		dek.RetiredAt = &retiredAt
		require.NoError(t, testPool.UpdateDEK(t.Context(), dek))

		// It is no longer returned as the active key.
		_, err := testPool.GetActiveDEK(t.Context(), projectID)
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})

	t.Run("update of missing dek affects no rows and does not error", func(t *testing.T) {
		projectID := withProject(t)
		dek := newTestDEK(uniqueDEKID(t), projectID, crypto.KeyStateActive)
		// Never created, so the UPDATE matches nothing.
		assert.NoError(t, testPool.UpdateDEK(t.Context(), dek))
	})
}
