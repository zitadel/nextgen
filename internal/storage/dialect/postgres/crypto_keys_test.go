//go:build postgres_integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// This is a storage-level test for the v2 postgres crypto-key statements.
// It follows the same shape as project_test.go: it drives the real database
// through the shared v2 testPool set up in TestMain. Encryption keys are
// foreign-keyed to a project, so each test creates a throwaway project and
// relies on the ON DELETE CASCADE from projects to clean up its keys.

// uniqueKeyID returns a collision-free key ID scoped to the running (sub)test.
func uniqueKeyID(t *testing.T) string {
	t.Helper()
	return "kek-" + uniqueSuffix(t)
}

// newTestKey builds a persistable project KEK in the given state referencing projectID.
func newTestKey(id, projectID string, state domain.KeyState) *domain.EncryptionKey {
	return &domain.EncryptionKey{
		ID:        id,
		ProjectID: projectID,
		Key:       "this is normally an encrypted key",
		Algorithm: jose.A256GCM,
		State:     state,
		Purpose:   domain.EncryptionKeyPurposeKEK,
	}
}

// withProject creates a project and registers cleanup, returning its ID.
func withProject(t *testing.T) string {
	t.Helper()
	project := newTestProject(uniqueProjectID(t))
	t.Cleanup(func() { _, _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
	require.NoError(t, testPool.CreateProject(t.Context(), project))
	return project.ID
}

func TestCryptoKeyStatements_CreateEncryptionKey(t *testing.T) {
	t.Parallel()

	t.Run("creates key and created_at is set", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		key := newTestKey(uniqueKeyID(t), projectID, domain.KeyStateActive)

		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), key))
		assert.False(t, key.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), key.CreatedAt, 5*time.Second)

		stored, err := testPool.GetEncryptionKey(t.Context(), database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), projectID))
		require.NoError(t, err)
		assert.Equal(t, key.ID, stored.ID)
		assert.Equal(t, projectID, stored.ProjectID)
		assert.Equal(t, key.Key, stored.Key)
		assert.Equal(t, jose.A256GCM, stored.Algorithm)
		assert.EqualValues(t, domain.KeyStateActive, stored.State)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.Nil(t, stored.ActivatedAt)
		assert.Nil(t, stored.RetiredAt)
	})

	t.Run("duplicate ID returns error", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		kek := newTestKey(uniqueKeyID(t), projectID, domain.KeyStateActive)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), kek))

		err := testPool.CreateEncryptionKey(t.Context(), newTestKey(kek.ID, projectID, domain.KeyStateActive))
		assert.Error(t, err)
	})

	t.Run("unknown project returns error", func(t *testing.T) {
		t.Parallel()

		kek := newTestKey(uniqueKeyID(t), uniqueProjectID(t), domain.KeyStateActive)
		err := testPool.CreateEncryptionKey(t.Context(), kek)
		assert.Error(t, err)
	})

	t.Run("second active kek for the same project is rejected", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), newTestKey(uniqueKeyID(t)+"-a", projectID, domain.KeyStateActive)))

		// The partial unique index permits only one active KEK per project.
		err := testPool.CreateEncryptionKey(t.Context(), newTestKey(uniqueKeyID(t)+"-b", projectID, domain.KeyStateActive))
		assert.Error(t, err)
	})
}

func TestCryptoKeyStatements_GetEncryptionKey(t *testing.T) {
	t.Parallel()

	t.Run("returns only filtered result", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)

		expired := newTestKey(uniqueKeyID(t)+"-old", projectID, domain.KeyStateExpired)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), expired))
		active := newTestKey(uniqueKeyID(t)+"-new", projectID, domain.KeyStateActive)
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), active))

		stored, err := testPool.GetEncryptionKey(t.Context(),
			database.And(
				database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.EncryptionKeyFieldState), domain.KeyStateActive),
			))
		require.NoError(t, err)
		assert.Equal(t, active.ID, stored.ID)
		assert.EqualValues(t, domain.KeyStateActive, stored.State)
	})

	t.Run("no results return no row found error", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		// Only a not-yet-active key exists.
		require.NoError(t, testPool.CreateEncryptionKey(t.Context(), newTestKey(uniqueKeyID(t), projectID, domain.KeyStateNotActiveYet)))

		_, err := testPool.GetEncryptionKey(t.Context(),
			database.And(
				database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.EncryptionKeyFieldState), domain.KeyStateActive),
			))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})

	t.Run("unknown project returns NoRowFoundError", func(t *testing.T) {
		t.Parallel()

		_, err := testPool.GetEncryptionKey(t.Context(), database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), uniqueProjectID(t)))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// newTestSigningKey builds a persistable signing key in the given state
// referencing projectID.
func newTestSigningKey(id, projectID string, state domain.KeyState) *domain.SigningKey {
	return &domain.SigningKey{
		ID:        id,
		ProjectID: projectID,
		Key:       "this is normally an encrypted seed",
		Algorithm: jose.EdDSA,
		State:     state,
		Purpose:   domain.SigningKeyPurposeToken,
	}
}

func TestCryptoKeyStatements_SigningKeys(t *testing.T) {
	t.Parallel()

	t.Run("round trips a stored key", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		key := newTestSigningKey(uniqueKeyID(t), projectID, domain.KeyStateActive)
		require.NoError(t, testPool.CreateSigningKey(t.Context(), key))
		assert.False(t, key.CreatedAt.IsZero(), "created_at is set by the database")

		stored, err := testPool.GetSigningKey(t.Context(),
			database.And(
				database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateActive),
				database.Equal(database.Col(domain.SigningKeyFieldPurpose), domain.SigningKeyPurposeToken),
			))
		require.NoError(t, err)
		assert.Equal(t, key.ID, stored.ID)
		assert.Equal(t, key.Key, stored.Key)
		assert.EqualValues(t, jose.EdDSA, stored.Algorithm)
		assert.EqualValues(t, domain.KeyStateActive, stored.State)
		assert.EqualValues(t, domain.SigningKeyPurposeToken, stored.Purpose)
	})

	t.Run("filters out non-active keys", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		require.NoError(t, testPool.CreateSigningKey(t.Context(),
			newTestSigningKey(uniqueKeyID(t), projectID, domain.KeyStateNotActiveYet)))

		_, err := testPool.GetSigningKey(t.Context(),
			database.And(
				database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateActive),
			))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})

	t.Run("at most one active token signing key per project", func(t *testing.T) {
		t.Parallel()

		projectID := withProject(t)
		require.NoError(t, testPool.CreateSigningKey(t.Context(),
			newTestSigningKey(uniqueKeyID(t)+"-a", projectID, domain.KeyStateActive)))

		err := testPool.CreateSigningKey(t.Context(),
			newTestSigningKey(uniqueKeyID(t)+"-b", projectID, domain.KeyStateActive))
		require.Error(t, err, "uq_token_signing_keys_active_per_project must reject a second active key")
	})
}
