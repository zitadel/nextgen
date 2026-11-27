//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func recoveryCodesByUserFilter(projectID, userID string) database.Filter[domain.UserRecoveryCodesField] {
	return database.And(
		database.Equal(database.Col(domain.UserRecoveryCodesFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserRecoveryCodesFieldUserID), userID),
	)
}

func recoveryCodesByIDFilter(id string) database.Filter[domain.UserRecoveryCodesField] {
	return database.Equal(database.Col(domain.UserRecoveryCodesFieldID), id)
}

func TestUserRecoveryCodesStatements_CRUD(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_rc"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "rc@example.com", "RC User")))

		codes := []string{"aaaa-bbbb-cccc", "dddd-eeee-ffff"}
		require.NoError(t, d.stmts.CreateUserRecoveryCodes(t.Context(), &domain.CreateRecoveryCodes{
			ProjectID:     projectID,
			UserID:        userID,
			RecoveryCodes: codes,
		}))

		got, err := d.stmts.GetUserRecoveryCodes(t.Context(), recoveryCodesByUserFilter(projectID, userID))
		require.NoError(t, err)
		require.NotEmpty(t, got.ID)
		assert.True(t, strings.HasPrefix(got.ID, string(domain.PrefixUserRecoveryCodes)+"_"))
		require.Equal(t, codes, got.RecoveryCodes)

		byID, err := d.stmts.GetUserRecoveryCodes(t.Context(), recoveryCodesByIDFilter(got.ID))
		require.NoError(t, err)
		require.Equal(t, got.ID, byID.ID)

		listed, err := d.stmts.ListUserRecoveryCodes(t.Context(), &database.ListOptions[domain.UserRecoveryCodesField]{
			Filter: database.Equal(database.Col(domain.UserRecoveryCodesFieldProjectID), projectID),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)

		require.NoError(t, d.stmts.DeleteUserRecoveryCodes(t.Context(), recoveryCodesByIDFilter(got.ID)))
		_, err = d.stmts.GetUserRecoveryCodes(t.Context(), recoveryCodesByUserFilter(projectID, userID))
		require.ErrorIs(t, err, new(database.NoRowFoundError))

		require.NoError(t, d.stmts.CreateUserRecoveryCodes(t.Context(), &domain.CreateRecoveryCodes{
			ProjectID:     projectID,
			UserID:        userID,
			RecoveryCodes: codes,
		}))
		got2, err := d.stmts.GetUserRecoveryCodes(t.Context(), recoveryCodesByUserFilter(projectID, userID))
		require.NoError(t, err)
		require.NotEmpty(t, got2.ID)
		require.NoError(t, d.stmts.DeleteUserRecoveryCodes(t.Context(), recoveryCodesByUserFilter(projectID, userID)))
		_, err = d.stmts.GetUserRecoveryCodes(t.Context(), recoveryCodesByUserFilter(projectID, userID))
		require.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestUserRecoveryCodesStatements_CreateEmptyRejected(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_rc_empty"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "rc-empty@example.com", "RC Empty")))

		err := d.stmts.CreateUserRecoveryCodes(t.Context(), &domain.CreateRecoveryCodes{
			ProjectID:     projectID,
			UserID:        userID,
			RecoveryCodes: nil,
		})
		assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)

		err = d.stmts.CreateUserRecoveryCodes(t.Context(), &domain.CreateRecoveryCodes{
			ProjectID:     projectID,
			UserID:        userID,
			RecoveryCodes: []string{},
		})
		assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)
	})
}

func TestUserRecoveryCodesStatements_Update(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_rc_upd"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "rc-upd@example.com", "RC Update")))
		require.NoError(t, d.stmts.CreateUserRecoveryCodes(t.Context(), &domain.CreateRecoveryCodes{
			ProjectID:     projectID,
			UserID:        userID,
			RecoveryCodes: []string{"old-code-1"},
		}))

		byUser := recoveryCodesByUserFilter(projectID, userID)

		err := d.stmts.UpdateUserRecoveryCodes(t.Context(), byUser)
		assert.ErrorIs(t, err, database.ErrNoChanges)

		err = d.stmts.UpdateUserRecoveryCodes(t.Context(), recoveryCodesByUserFilter(projectID, "missing-user"),
			&domain.UserRecoveryCodesIncrementFailedAttemptsUpdate{Delta: 1},
		)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		err = d.stmts.UpdateUserRecoveryCodes(t.Context(), byUser,
			&domain.UserRecoveryCodesCodesUpdate{Codes: nil},
		)
		assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)

		err = d.stmts.UpdateUserRecoveryCodes(t.Context(), byUser,
			&domain.UserRecoveryCodesCodesUpdate{Codes: []string{}},
		)
		assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)

		now := time.Now().UTC().Truncate(time.Millisecond)
		require.NoError(t, d.stmts.UpdateUserRecoveryCodes(t.Context(), byUser,
			&domain.UserRecoveryCodesCodesUpdate{Codes: []string{"new-a", "new-b"}},
			&domain.UserRecoveryCodesLastSuccessfulCheckUpdate{LastSuccessfulCheck: &now},
			&domain.UserRecoveryCodesResetFailedAttemptsUpdate{},
		))

		got, err := d.stmts.GetUserRecoveryCodes(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, []string{"new-a", "new-b"}, got.RecoveryCodes)
		require.NotNil(t, got.LastSuccessfulCheck)
		assert.WithinDuration(t, now, *got.LastSuccessfulCheck, time.Second)
		assert.Zero(t, got.FailedAttempts)

		require.NoError(t, d.stmts.UpdateUserRecoveryCodes(t.Context(), byUser,
			&domain.UserRecoveryCodesIncrementFailedAttemptsUpdate{Delta: 2},
		))
		got, err = d.stmts.GetUserRecoveryCodes(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, int16(2), got.FailedAttempts)

		require.NoError(t, d.stmts.UpdateUserRecoveryCodes(t.Context(), byUser,
			&domain.UserRecoveryCodesLastSuccessfulCheckUpdate{LastSuccessfulCheck: nil},
		))
		got, err = d.stmts.GetUserRecoveryCodes(t.Context(), byUser)
		require.NoError(t, err)
		assert.Nil(t, got.LastSuccessfulCheck)
	})
}
