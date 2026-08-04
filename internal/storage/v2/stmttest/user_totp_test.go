//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func totpByUserFilter(projectID, userID string) database.Filter[domain.UserTOTPField] {
	return database.And(
		database.Equal(database.Col(domain.UserTOTPFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserTOTPFieldUserID), userID),
	)
}

func totpByIDFilter(id string) database.Filter[domain.UserTOTPField] {
	return database.Equal(database.Col(domain.UserTOTPFieldID), id)
}

func TestUserTOTPStatements_CRUD(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_totp_1"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "totp@example.com", "TOTP User")))

		secret := []byte("totp-secret-bytes")
		require.NoError(t, d.stmts.CreateUserTOTP(t.Context(), &domain.CreateUserTOTP{
			ProjectID: projectID,
			UserID:    userID,
			Secret:    secret,
		}))
		byUser := totpByUserFilter(projectID, userID)
		t.Cleanup(func() {
			_ = d.stmts.DeleteUserTOTP(context.Background(), byUser)
		})

		got, err := d.stmts.GetUserTOTP(t.Context(), byUser)
		require.NoError(t, err)
		require.NotEmpty(t, got.ID)
		assert.True(t, strings.HasPrefix(got.ID, string(domain.PrefixUserTOTP)+"_"))
		assert.Equal(t, projectID, got.ProjectID)
		assert.Equal(t, userID, got.UserID)
		assert.Equal(t, secret, got.Secret)
		assert.Zero(t, got.FailedAttempts)
		assert.True(t, got.VerifiedAt.IsZero())
		assert.Nil(t, got.LastSuccessfulCheck)
		assert.False(t, got.CreatedAt.IsZero())
		assert.False(t, got.UpdatedAt.IsZero())

		byID, err := d.stmts.GetUserTOTP(t.Context(), totpByIDFilter(got.ID))
		require.NoError(t, err)
		assert.Equal(t, got.ID, byID.ID)

		listed, err := d.stmts.ListUserTOTPs(t.Context(), &database.ListOptions[domain.UserTOTPField]{
			Filter: database.Equal(database.Col(domain.UserTOTPFieldProjectID), projectID),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)

		got.Secret[0] ^= 0xff
		again, err := d.stmts.GetUserTOTP(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, secret, again.Secret)

		require.NoError(t, d.stmts.DeleteUserTOTP(t.Context(), totpByIDFilter(got.ID)))
		_, err = d.stmts.GetUserTOTP(t.Context(), byUser)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		require.NoError(t, d.stmts.CreateUserTOTP(t.Context(), &domain.CreateUserTOTP{
			ProjectID: projectID,
			UserID:    userID,
			Secret:    secret,
		}))
		got2, err := d.stmts.GetUserTOTP(t.Context(), byUser)
		require.NoError(t, err)
		require.NotEmpty(t, got2.ID)
		require.NoError(t, d.stmts.DeleteUserTOTP(t.Context(), byUser))
		_, err = d.stmts.GetUserTOTP(t.Context(), byUser)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestUserTOTPStatements_Update(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_totp_update"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "totp-upd@example.com", "TOTP Update")))
		require.NoError(t, d.stmts.CreateUserTOTP(t.Context(), &domain.CreateUserTOTP{
			ProjectID: projectID,
			UserID:    userID,
			Secret:    []byte("initial-secret"),
		}))
		byUser := totpByUserFilter(projectID, userID)
		t.Cleanup(func() {
			_ = d.stmts.DeleteUserTOTP(context.Background(), byUser)
		})

		err := d.stmts.UpdateUserTOTP(t.Context(), byUser)
		assert.ErrorIs(t, err, database.ErrNoChanges)

		err = d.stmts.UpdateUserTOTP(t.Context(), totpByUserFilter(projectID, "missing-user"),
			&domain.UserTOTPIncrementFailedAttemptsUpdate{Delta: 1},
		)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		now := time.Now().UTC().Truncate(time.Millisecond)
		newSecret := []byte("rotated-secret")
		require.NoError(t, d.stmts.UpdateUserTOTP(t.Context(), byUser,
			&domain.UserTOTPSecretUpdate{Secret: newSecret},
			&domain.UserTOTPVerifiedAtUpdate{VerifiedAt: now},
			&domain.UserTOTPLastSuccessfulCheckUpdate{LastSuccessfulCheck: now},
			&domain.UserTOTPResetFailedAttemptsUpdate{},
		))

		got, err := d.stmts.GetUserTOTP(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, newSecret, got.Secret)
		assert.WithinDuration(t, now, got.VerifiedAt, time.Second)
		require.NotNil(t, got.LastSuccessfulCheck)
		assert.WithinDuration(t, now, *got.LastSuccessfulCheck, time.Second)
		assert.Zero(t, got.FailedAttempts)

		require.NoError(t, d.stmts.UpdateUserTOTP(t.Context(), byUser,
			&domain.UserTOTPIncrementFailedAttemptsUpdate{Delta: 2},
		))
		got, err = d.stmts.GetUserTOTP(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, int16(2), got.FailedAttempts)
	})
}
