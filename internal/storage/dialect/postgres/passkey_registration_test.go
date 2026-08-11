//go:build postgres_integration

package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func uniquePasskeyRegIDs(t *testing.T) (projectID, regID, userID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-pkreg-" + suffix, "pkreg-" + suffix, "usr-pkreg-" + suffix
}

func TestPasskeyRegistrationStatements_CRUD(t *testing.T) {
	projectID, regID, userID := uniquePasskeyRegIDs(t)
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	challenge := &domain.PasskeyRegistrationChallenge{
		Challenge:   "test-challenge",
		UserID:      userID,
		Username:    "alice@example.com",
		DisplayName: "Alice",
	}
	create := &domain.CreatePasskeyRegistration{
		ID:        regID,
		ProjectID: projectID,
		UserID:    userID,
		Challenge: challenge,
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}
	require.NoError(t, testPool.CreatePasskeyRegistration(t.Context(), create))
	t.Cleanup(func() {
		_ = testPool.DeletePasskeyRegistration(context.Background(), projectID, regID)
	})

	got, err := testPool.GetPasskeyRegistration(t.Context(), projectID, regID)
	require.NoError(t, err)
	assert.Equal(t, regID, got.ID)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, userID, got.UserID)
	require.NotNil(t, got.Challenge)
	assert.Equal(t, "alice@example.com", got.Challenge.Username)
	assert.Equal(t, "Alice", got.Challenge.DisplayName)
	assert.False(t, got.CreatedAt.IsZero())

	require.NoError(t, testPool.DeletePasskeyRegistration(t.Context(), projectID, regID))
	_, err = testPool.GetPasskeyRegistration(t.Context(), projectID, regID)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestPasskeyRegistrationStatements_Create_EmptyIDAssigned(t *testing.T) {
	projectID, _, userID := uniquePasskeyRegIDs(t)
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	create := &domain.CreatePasskeyRegistration{
		ProjectID: projectID,
		UserID:    userID,
		Challenge: &domain.PasskeyRegistrationChallenge{Username: "alice"},
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}
	require.NoError(t, testPool.CreatePasskeyRegistration(t.Context(), create))
	t.Cleanup(func() {
		_ = testPool.DeletePasskeyRegistration(context.Background(), projectID, create.ID)
	})

	require.NotEmpty(t, create.ID)
	assert.True(t, strings.HasPrefix(create.ID, string(domain.PrefixPasskeyRegistration)+"_"))

	got, err := testPool.GetPasskeyRegistration(t.Context(), projectID, create.ID)
	require.NoError(t, err)
	assert.Equal(t, create.ID, got.ID)
}

func TestPasskeyRegistrationStatements_Get_Expired(t *testing.T) {
	projectID, regID, userID := uniquePasskeyRegIDs(t)
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	require.NoError(t, testPool.CreatePasskeyRegistration(t.Context(), &domain.CreatePasskeyRegistration{
		ID:        regID,
		ProjectID: projectID,
		UserID:    userID,
		Challenge: &domain.PasskeyRegistrationChallenge{Username: "bob"},
		ExpiresAt: time.Now().Add(-time.Minute),
	}))
	t.Cleanup(func() {
		_ = testPool.DeletePasskeyRegistration(context.Background(), projectID, regID)
	})

	_, err := testPool.GetPasskeyRegistration(t.Context(), projectID, regID)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
