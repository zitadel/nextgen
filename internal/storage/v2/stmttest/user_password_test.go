//go:build postgres_integration || spanner_integration

package stmttest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func userPasswordByUser(projectID, userID string) database.Filter[domain.UserPasswordField] {
	return database.And(
		database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
	)
}

func userPasswordByID(id int64) database.Filter[domain.UserPasswordField] {
	return database.Equal(database.Col(domain.UserPasswordFieldID), id)
}

func TestUserPasswordStatements_SetGetDelete(t *testing.T) {
	ctx := t.Context()
	s := stmts()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "usr_pw"

	require.NoError(t, s.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "pw@example.com", "PW User")))

	vid := "verif-1"
	require.NoError(t, s.SetUserPassword(ctx, &domain.SetUserPassword{
		ProjectID:      projectID,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$fake",
		ChangeRequired: true,
		VerificationID: &vid,
	}))

	byUser := userPasswordByUser(projectID, userID)
	got, err := s.GetUserPassword(ctx, byUser)
	require.NoError(t, err)
	require.Positive(t, got.ID)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, userID, got.UserID)
	assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$fake", got.EncodedHash)
	assert.True(t, got.ChangeRequired)
	require.NotNil(t, got.VerificationID)
	assert.Equal(t, vid, *got.VerificationID)

	gotByID, err := s.GetUserPassword(ctx, userPasswordByID(got.ID))
	require.NoError(t, err)
	assert.Equal(t, got.ID, gotByID.ID)

	list, err := s.ListUserPasswords(ctx, &database.ListOptions[domain.UserPasswordField]{
		Filter: database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)

	require.NoError(t, s.DeleteUserPassword(ctx, userPasswordByID(got.ID)))
	_, err = s.GetUserPassword(ctx, byUser)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))

	require.NoError(t, s.SetUserPassword(ctx, &domain.SetUserPassword{
		ProjectID:   projectID,
		UserID:      userID,
		EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$fake",
	}))
	got2, err := s.GetUserPassword(ctx, byUser)
	require.NoError(t, err)
	require.Positive(t, got2.ID)
	require.NoError(t, s.DeleteUserPassword(ctx, byUser))
	_, err = s.GetUserPassword(ctx, byUser)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestUserPasswordStatements_SetUpsert(t *testing.T) {
	ctx := t.Context()
	s := stmts()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "usr_pw_upsert"

	require.NoError(t, s.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "pw-upsert@example.com", "PW Upsert")))

	byUser := userPasswordByUser(projectID, userID)
	require.NoError(t, s.SetUserPassword(ctx, &domain.SetUserPassword{
		ProjectID:      projectID,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$initial",
		ChangeRequired: true,
	}))
	got, err := s.GetUserPassword(ctx, byUser)
	require.NoError(t, err)
	initialID := got.ID

	now := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, s.UpdateUserPassword(ctx, byUser,
		&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 3},
		&domain.UserPasswordLastSuccessfulCheckUpdate{LastSuccessfulCheck: now},
	))

	require.NoError(t, s.SetUserPassword(ctx, &domain.SetUserPassword{
		ProjectID:      projectID,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$updated",
		ChangeRequired: false,
	}))
	got2, err := s.GetUserPassword(ctx, byUser)
	require.NoError(t, err)
	assert.Equal(t, initialID, got2.ID)
	assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$updated", got2.EncodedHash)
	assert.False(t, got2.ChangeRequired)
	assert.Zero(t, got2.FailedAttempts)
	assert.Nil(t, got2.LastSuccessfulCheck)
	assert.WithinDuration(t, time.Now(), got2.ChangedAt, 5*time.Second)
}

func TestUserPasswordStatements_SetMissingUser(t *testing.T) {
	ctx := t.Context()
	s := stmts()
	projectID, _ := ensureUserTestProject(t)

	err := s.SetUserPassword(ctx, &domain.SetUserPassword{
		ProjectID:   projectID,
		UserID:      "missing-user",
		EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$fake",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.ForeignKeyError))
}

func TestUserPasswordStatements_Update(t *testing.T) {
	ctx := t.Context()
	s := stmts()
	projectID, schemaURL := ensureUserTestProject(t)
	userID := "usr_pw_upd"

	require.NoError(t, s.CreateUser(ctx, newTestUser(t, projectID, schemaURL, userID, "pw-upd@example.com", "PW Update")))
	require.NoError(t, s.SetUserPassword(ctx, &domain.SetUserPassword{
		ProjectID:   projectID,
		UserID:      userID,
		EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$initial",
	}))

	byUser := userPasswordByUser(projectID, userID)

	err := s.UpdateUserPassword(ctx, byUser)
	assert.ErrorIs(t, err, database.ErrNoChanges)

	err = s.UpdateUserPassword(ctx, userPasswordByUser(projectID, "missing-user"),
		&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1},
	)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))

	now := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, s.UpdateUserPassword(ctx, byUser,
		&domain.UserPasswordEncodedHashUpdate{EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$rotated"},
		&domain.UserPasswordChangeRequiredUpdate{ChangeRequired: true},
		&domain.UserPasswordChangedAtUpdate{ChangedAt: now},
		&domain.UserPasswordVerificationIDUpdate{VerificationID: "verif-upd"},
		&domain.UserPasswordLastSuccessfulCheckUpdate{LastSuccessfulCheck: now},
		&domain.UserPasswordResetFailedAttemptsUpdate{},
	))

	got, err := s.GetUserPassword(ctx, byUser)
	require.NoError(t, err)
	assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$rotated", got.EncodedHash)
	assert.True(t, got.ChangeRequired)
	assert.WithinDuration(t, now, got.ChangedAt, time.Second)
	require.NotNil(t, got.VerificationID)
	assert.Equal(t, "verif-upd", *got.VerificationID)
	require.NotNil(t, got.LastSuccessfulCheck)
	assert.WithinDuration(t, now, *got.LastSuccessfulCheck, time.Second)
	assert.Zero(t, got.FailedAttempts)

	require.NoError(t, s.UpdateUserPassword(ctx, byUser,
		&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 2},
	))
	got, err = s.GetUserPassword(ctx, byUser)
	require.NoError(t, err)
	assert.Equal(t, int16(2), got.FailedAttempts)

	require.NoError(t, s.DeleteUserPassword(ctx, byUser))
	_, err = s.GetUserPassword(ctx, byUser)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
