//go:build spanner_integration

package spanner

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func recoveryCodesByUserFilter(projectID, userID string) v2database.Filter[domain.UserRecoveryCodesField] {
	return v2database.And(
		v2database.Equal(v2database.Col(domain.UserRecoveryCodesFieldProjectID), projectID),
		v2database.Equal(v2database.Col(domain.UserRecoveryCodesFieldUserID), userID),
	)
}

func recoveryCodesByIDFilter(id int64) v2database.Filter[domain.UserRecoveryCodesField] {
	return v2database.Equal(v2database.Col(domain.UserRecoveryCodesFieldID), id)
}

func TestUserRecoveryCodesStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "usr_rc"

	require.NoError(t, stmts.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "rc@example.com", "RC User")))

	codes := []string{"aaaa-bbbb-cccc", "dddd-eeee-ffff"}
	require.NoError(t, stmts.CreateUserRecoveryCodes(ctx, &domain.CreateRecoveryCodes{
		ProjectID:     projectID,
		UserID:        userID,
		RecoveryCodes: codes,
	}))

	got, err := stmts.GetUserRecoveryCodes(ctx, recoveryCodesByUserFilter(projectID, userID))
	require.NoError(t, err)
	require.Positive(t, got.ID)
	require.Equal(t, codes, got.RecoveryCodes)

	byID, err := stmts.GetUserRecoveryCodes(ctx, recoveryCodesByIDFilter(got.ID))
	require.NoError(t, err)
	require.Equal(t, got.ID, byID.ID)

	listed, err := stmts.ListUserRecoveryCodes(ctx, &v2database.ListOptions[domain.UserRecoveryCodesField]{
		Filter: v2database.Equal(v2database.Col(domain.UserRecoveryCodesFieldProjectID), projectID),
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)

	require.NoError(t, stmts.DeleteUserRecoveryCodes(ctx, recoveryCodesByIDFilter(got.ID)))
	_, err = stmts.GetUserRecoveryCodes(ctx, recoveryCodesByUserFilter(projectID, userID))
	require.ErrorIs(t, err, new(legacydb.NoRowFoundError))

	require.NoError(t, stmts.CreateUserRecoveryCodes(ctx, &domain.CreateRecoveryCodes{
		ProjectID:     projectID,
		UserID:        userID,
		RecoveryCodes: codes,
	}))
	got2, err := stmts.GetUserRecoveryCodes(ctx, recoveryCodesByUserFilter(projectID, userID))
	require.NoError(t, err)
	require.Positive(t, got2.ID)
	require.NoError(t, stmts.DeleteUserRecoveryCodes(ctx, recoveryCodesByUserFilter(projectID, userID)))
	_, err = stmts.GetUserRecoveryCodes(ctx, recoveryCodesByUserFilter(projectID, userID))
	require.ErrorIs(t, err, new(legacydb.NoRowFoundError))
}

func TestUserRecoveryCodesStatements_CreateEmptyRejected(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "usr_rc_empty"

	require.NoError(t, stmts.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "rc-empty@example.com", "RC Empty")))

	err := stmts.CreateUserRecoveryCodes(ctx, &domain.CreateRecoveryCodes{
		ProjectID:     projectID,
		UserID:        userID,
		RecoveryCodes: nil,
	})
	assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)

	err = stmts.CreateUserRecoveryCodes(ctx, &domain.CreateRecoveryCodes{
		ProjectID:     projectID,
		UserID:        userID,
		RecoveryCodes: []string{},
	})
	assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)
}

func TestUserRecoveryCodesStatements_Update(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "usr_rc_upd"

	require.NoError(t, stmts.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "rc-upd@example.com", "RC Update")))
	require.NoError(t, stmts.CreateUserRecoveryCodes(ctx, &domain.CreateRecoveryCodes{
		ProjectID:     projectID,
		UserID:        userID,
		RecoveryCodes: []string{"old-code-1"},
	}))

	byUser := recoveryCodesByUserFilter(projectID, userID)

	err := stmts.UpdateUserRecoveryCodes(ctx, byUser)
	assert.ErrorIs(t, err, v2database.ErrNoChanges)

	err = stmts.UpdateUserRecoveryCodes(ctx, recoveryCodesByUserFilter(projectID, "missing-user"),
		&domain.UserRecoveryCodesIncrementFailedAttemptsUpdate{Delta: 1},
	)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))

	err = stmts.UpdateUserRecoveryCodes(ctx, byUser,
		domain.NewUserRecoveryCodesCodesUpdate(nil),
	)
	assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)

	err = stmts.UpdateUserRecoveryCodes(ctx, byUser,
		domain.NewUserRecoveryCodesCodesUpdate([]string{}),
	)
	assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)

	now := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, stmts.UpdateUserRecoveryCodes(ctx, byUser,
		domain.NewUserRecoveryCodesCodesUpdate([]string{"new-a", "new-b"}),
		&domain.UserRecoveryCodesLastSuccessfulCheckUpdate{LastSuccessfulCheck: &now},
		&domain.UserRecoveryCodesResetFailedAttemptsUpdate{},
	))

	got, err := stmts.GetUserRecoveryCodes(ctx, byUser)
	require.NoError(t, err)
	assert.Equal(t, []string{"new-a", "new-b"}, got.RecoveryCodes)
	require.NotNil(t, got.LastSuccessfulCheck)
	assert.WithinDuration(t, now, *got.LastSuccessfulCheck, time.Second)
	assert.Zero(t, got.FailedAttempts)

	require.NoError(t, stmts.UpdateUserRecoveryCodes(ctx, byUser,
		&domain.UserRecoveryCodesIncrementFailedAttemptsUpdate{Delta: 2},
	))
	got, err = stmts.GetUserRecoveryCodes(ctx, byUser)
	require.NoError(t, err)
	assert.Equal(t, int16(2), got.FailedAttempts)

	require.NoError(t, stmts.UpdateUserRecoveryCodes(ctx, byUser,
		&domain.UserRecoveryCodesLastSuccessfulCheckUpdate{LastSuccessfulCheck: nil},
	))
	got, err = stmts.GetUserRecoveryCodes(ctx, byUser)
	require.NoError(t, err)
	assert.Nil(t, got.LastSuccessfulCheck)
}
