//go:build sqlite_integration

package sqlite

import (
	"context"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueKeyID(t *testing.T) string {
	t.Helper()
	return "key-" + t.Name()
}

func withProject(t *testing.T) string {
	t.Helper()
	projectID := "proj-" + t.Name()
	require.NoError(t, testPool.CreateProject(t.Context(), &domain.Project{ID: projectID, Name: "crypto"}))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
	return projectID
}

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
	t.Run("round trips a stored key", func(t *testing.T) {
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
		projectID := withProject(t)
		require.NoError(t, testPool.CreateSigningKey(t.Context(),
			newTestSigningKey(uniqueKeyID(t)+"-a", projectID, domain.KeyStateActive)))

		err := testPool.CreateSigningKey(t.Context(),
			newTestSigningKey(uniqueKeyID(t)+"-b", projectID, domain.KeyStateActive))
		require.Error(t, err, "idx_signing_keys_active_token_signing_key must reject a second active key")
	})
}
