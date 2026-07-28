//go:build spanner_integration

package spanner

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestUserTOTPStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "user_totp_1"

	require.NoError(t, stmts.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "totp@example.com", "TOTP User")))

	secret := []byte("totp-secret-bytes")
	require.NoError(t, stmts.CreateUserTOTP(ctx, &domain.CreateUserTOTP{
		ProjectID: projectID,
		UserID:    userID,
		Secret:    secret,
	}))
	t.Cleanup(func() {
		_ = stmts.DeleteUserTOTPByUserID(context.Background(), projectID, userID)
	})

	got, err := stmts.GetUserTOTPByUserID(ctx, projectID, userID)
	require.NoError(t, err)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, userID, got.UserID)
	assert.Equal(t, secret, got.Secret)
	assert.Zero(t, got.FailedAttempts)
	assert.True(t, got.VerifiedAt.IsZero())
	assert.Nil(t, got.LastSuccessfulCheck)
	assert.False(t, got.CreatedAt.IsZero())
	assert.False(t, got.UpdatedAt.IsZero())

	got.Secret[0] ^= 0xff
	again, err := stmts.GetUserTOTPByUserID(ctx, projectID, userID)
	require.NoError(t, err)
	assert.Equal(t, secret, again.Secret)

	require.NoError(t, stmts.DeleteUserTOTPByUserID(ctx, projectID, userID))
	_, err = stmts.GetUserTOTPByUserID(ctx, projectID, userID)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
}

func TestUserTOTPStatements_Update(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "user_totp_update"

	require.NoError(t, stmts.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "totp-upd@example.com", "TOTP Update")))
	require.NoError(t, stmts.CreateUserTOTP(ctx, &domain.CreateUserTOTP{
		ProjectID: projectID,
		UserID:    userID,
		Secret:    []byte("initial-secret"),
	}))
	t.Cleanup(func() {
		_ = stmts.DeleteUserTOTPByUserID(context.Background(), projectID, userID)
	})

	err := stmts.UpdateUserTOTP(ctx, projectID, userID)
	assert.ErrorIs(t, err, database.ErrNoChanges)

	err = stmts.UpdateUserTOTP(ctx, projectID, "missing-user",
		&domain.UserTOTPIncrementFailedAttemptsUpdate{Delta: 1},
	)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))

	now := time.Now().UTC().Truncate(time.Millisecond)
	newSecret := []byte("rotated-secret")
	require.NoError(t, stmts.UpdateUserTOTP(ctx, projectID, userID,
		domain.NewUserTOTPSecretUpdate(newSecret),
		&domain.UserTOTPVerifiedAtUpdate{VerifiedAt: now},
		&domain.UserTOTPLastSuccessfulCheckUpdate{LastSuccessfulCheck: now},
		&domain.UserTOTPResetFailedAttemptsUpdate{},
	))

	got, err := stmts.GetUserTOTPByUserID(ctx, projectID, userID)
	require.NoError(t, err)
	assert.Equal(t, newSecret, got.Secret)
	assert.WithinDuration(t, now, got.VerifiedAt, time.Second)
	require.NotNil(t, got.LastSuccessfulCheck)
	assert.WithinDuration(t, now, *got.LastSuccessfulCheck, time.Second)
	assert.Zero(t, got.FailedAttempts)

	require.NoError(t, stmts.UpdateUserTOTP(ctx, projectID, userID,
		&domain.UserTOTPIncrementFailedAttemptsUpdate{Delta: 1},
		&domain.UserTOTPIncrementFailedAttemptsUpdate{Delta: 1},
	))
	got, err = stmts.GetUserTOTPByUserID(ctx, projectID, userID)
	require.NoError(t, err)
	assert.Equal(t, int16(2), got.FailedAttempts)
}
