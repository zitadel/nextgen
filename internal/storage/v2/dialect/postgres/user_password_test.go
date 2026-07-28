//go:build postgres_integration

package postgres

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

func seedUserForPassword(t *testing.T, projectID, teamID, schemaURL, userID string) {
	t.Helper()
	ctx := t.Context()
	require.NoError(t, testPool.CreateProject(ctx, &domain.Project{ID: projectID, PreviewOrigins: []string{}}))
	_, err := testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1, $2)`,
		projectID, teamID)
	require.NoError(t, err)
	_, err = testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3::json)`,
		projectID, schemaURL, []byte("{}"))
	require.NoError(t, err)
	_, err = testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, lifecycle_owner_team_id, status) VALUES ($1, $2, $3, NULL, $4)`,
		projectID, schemaURL, userID, domain.UserStatusActive.String())
	require.NoError(t, err)
}

func TestUserPasswordStatements_SetGetDelete(t *testing.T) {
	projectID := uniqueProjectID(t)
	teamID := "team-" + projectID
	schemaURL := "https://schemas.test/" + projectID + ".json"
	userID := "usr_pw_" + projectID
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	seedUserForPassword(t, projectID, teamID, schemaURL, userID)

	vid := "verif-1"
	require.NoError(t, testPool.SetUserPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:      projectID,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$fake",
		ChangeRequired: true,
		VerificationID: &vid,
	}))

	got, err := testPool.GetUserPasswordByUserID(t.Context(), projectID, userID)
	require.NoError(t, err)
	require.Positive(t, got.ID)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, userID, got.UserID)
	assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$fake", got.EncodedHash)
	assert.True(t, got.ChangeRequired)
	require.NotNil(t, got.VerificationID)
	assert.Equal(t, vid, *got.VerificationID)

	list, err := testPool.ListUserPasswords(t.Context(), &database.ListOptions[domain.UserPasswordField]{
		Filter: database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)

	require.NoError(t, testPool.DeleteUserPasswordByUserID(t.Context(), projectID, userID))
	_, err = testPool.GetUserPasswordByUserID(t.Context(), projectID, userID)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
}

func TestUserPasswordStatements_SetUpsert(t *testing.T) {
	projectID := uniqueProjectID(t)
	teamID := "team-" + projectID
	schemaURL := "https://schemas.test/" + projectID + "-upsert.json"
	userID := "usr_pw_upsert_" + projectID
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	seedUserForPassword(t, projectID, teamID, schemaURL, userID)

	require.NoError(t, testPool.SetUserPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:      projectID,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$initial",
		ChangeRequired: true,
	}))
	got, err := testPool.GetUserPasswordByUserID(t.Context(), projectID, userID)
	require.NoError(t, err)
	initialID := got.ID

	_, err = testPool.pool.Exec(t.Context(),
		`UPDATE zitadel_nextgen.user_passwords SET failed_attempts = 3, last_successful_check = NOW() WHERE project_id = $1 AND user_id = $2`,
		projectID, userID)
	require.NoError(t, err)

	require.NoError(t, testPool.SetUserPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:      projectID,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$updated",
		ChangeRequired: false,
	}))
	got2, err := testPool.GetUserPasswordByUserID(t.Context(), projectID, userID)
	require.NoError(t, err)
	assert.Equal(t, initialID, got2.ID)
	assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$updated", got2.EncodedHash)
	assert.False(t, got2.ChangeRequired)
	assert.Zero(t, got2.FailedAttempts)
	assert.Nil(t, got2.LastSuccessfulCheck)
	assert.WithinDuration(t, time.Now(), got2.ChangedAt, 5*time.Second)
}

func TestUserPasswordStatements_SetMissingUser(t *testing.T) {
	projectID := uniqueProjectID(t)
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
	require.NoError(t, testPool.CreateProject(t.Context(), &domain.Project{ID: projectID, PreviewOrigins: []string{}}))

	err := testPool.SetUserPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   projectID,
		UserID:      "missing-user",
		EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$fake",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, new(legacydb.ForeignKeyError))
}

func TestUserPasswordStatements_Update(t *testing.T) {
	projectID := uniqueProjectID(t)
	teamID := "team-" + projectID
	schemaURL := "https://schemas.test/" + projectID + "-upd.json"
	userID := "usr_pw_upd_" + projectID
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	seedUserForPassword(t, projectID, teamID, schemaURL, userID)
	require.NoError(t, testPool.SetUserPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   projectID,
		UserID:      userID,
		EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$initial",
	}))

	err := testPool.UpdateUserPassword(t.Context(), projectID, userID)
	assert.ErrorIs(t, err, database.ErrNoChanges)

	err = testPool.UpdateUserPassword(t.Context(), projectID, "missing-user",
		&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1},
	)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))

	now := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, testPool.UpdateUserPassword(t.Context(), projectID, userID,
		&domain.UserPasswordEncodedHashUpdate{EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$rotated"},
		&domain.UserPasswordChangeRequiredUpdate{ChangeRequired: true},
		&domain.UserPasswordChangedAtUpdate{ChangedAt: now},
		&domain.UserPasswordVerificationIDUpdate{VerificationID: "verif-upd"},
		&domain.UserPasswordLastSuccessfulCheckUpdate{LastSuccessfulCheck: now},
		&domain.UserPasswordResetFailedAttemptsUpdate{},
	))

	got, err := testPool.GetUserPasswordByUserID(t.Context(), projectID, userID)
	require.NoError(t, err)
	assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$rotated", got.EncodedHash)
	assert.True(t, got.ChangeRequired)
	assert.WithinDuration(t, now, got.ChangedAt, time.Second)
	require.NotNil(t, got.VerificationID)
	assert.Equal(t, "verif-upd", *got.VerificationID)
	require.NotNil(t, got.LastSuccessfulCheck)
	assert.WithinDuration(t, now, *got.LastSuccessfulCheck, time.Second)
	assert.Zero(t, got.FailedAttempts)

	require.NoError(t, testPool.UpdateUserPassword(t.Context(), projectID, userID,
		&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1},
		&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1},
	))
	got, err = testPool.GetUserPasswordByUserID(t.Context(), projectID, userID)
	require.NoError(t, err)
	assert.Equal(t, int16(2), got.FailedAttempts)
}
