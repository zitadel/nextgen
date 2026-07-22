//go:build postgres_integration || spanner_integration

package repository_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func insertProjectTeamSchemaUser(t *testing.T, tx database.Transaction, pid, tid, schemaURL, userID string) {
	t.Helper()
	ctx := t.Context()
	_, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (id) VALUES ($1)`, dbTable("projects")), pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (project_id, id) VALUES ($1,$2)`, dbTable("teams")), pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO %s (project_id, url, payload) VALUES ($1,$2,$3%s)`, dbTable("json_schemas"), jsonCast()),
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO %s (project_id, schema_url, id, lifecycle_owner_team_id, status) VALUES ($1,$2,$3,$4,$5)`, dbTable("users")),
		pid, schemaURL, userID, tid, domain.UserStatusActive.String(),
	)
	require.NoError(t, err)
}

func TestUserPasswordRepository_CRUD(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserPasswordRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-cred-pw"
		tid       = "team-cred-pw"
		schemaURL = "https://schemas.test/cred-pw.json"
		userID    = "usr_pw"
	)

	insertProjectTeamSchemaUser(t, tx, pid, tid, schemaURL, userID)

	vid := "verif-1"
	require.NoError(t, repo.Set(ctx, tx, &domain.SetUserPassword{
		ProjectID:      pid,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$fake",
		ChangeRequired: true,
		VerificationID: &vid,
	}))

	got, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.NoError(t, err)
	require.Positive(t, got.ID)
	require.Equal(t, pid, got.ProjectID)
	require.Equal(t, userID, got.UserID)
	require.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$fake", got.EncodedHash)
	require.True(t, got.ChangeRequired)
	require.NotNil(t, got.VerificationID)
	require.Equal(t, vid, *got.VerificationID)

	byID, err := repo.Get(ctx, tx, database.WithCondition(repo.PrimaryKeyCondition(got.ID)))
	require.NoError(t, err)
	require.Equal(t, got.ID, byID.ID)

	list, err := repo.List(ctx, tx, database.WithCondition(repo.ProjectIDCondition(pid)))
	require.NoError(t, err)
	require.Len(t, list, 1)

	require.NoError(t, repo.Delete(ctx, tx, repo.PrimaryKeyCondition(got.ID)))
	_, err = repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))

	require.NoError(t, repo.Set(ctx, tx, &domain.SetUserPassword{
		ProjectID:      pid,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$fake2",
		ChangeRequired: false,
		VerificationID: nil,
	}))
	got2, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.NoError(t, err)
	require.Positive(t, got2.ID)
	require.NoError(t, repo.Delete(ctx, tx, repo.UniqueCondition(pid, userID)))
	_, err = repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestUserPasswordRepository_SetUpsert(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserPasswordRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-cred-pw-upsert"
		tid       = "team-cred-pw-upsert"
		schemaURL = "https://schemas.test/cred-pw-upsert.json"
		userID    = "usr_pw_upsert"
	)

	insertProjectTeamSchemaUser(t, tx, pid, tid, schemaURL, userID)

	require.NoError(t, repo.Set(ctx, tx, &domain.SetUserPassword{
		ProjectID:      pid,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$initial",
		ChangeRequired: true,
	}))

	got, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.NoError(t, err)
	initialID := got.ID
	require.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$initial", got.EncodedHash)
	require.True(t, got.ChangeRequired)

	_, err = tx.Exec(ctx,
		fmt.Sprintf(`UPDATE %s SET failed_attempts = 3, last_successful_check = NOW() WHERE project_id = $1 AND user_id = $2`, dbTable("user_passwords")),
		pid, userID,
	)
	require.NoError(t, err)

	require.NoError(t, repo.Set(ctx, tx, &domain.SetUserPassword{
		ProjectID:      pid,
		UserID:         userID,
		EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$updated",
		ChangeRequired: false,
	}))

	got2, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.NoError(t, err)
	require.Equal(t, initialID, got2.ID)
	require.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$updated", got2.EncodedHash)
	require.False(t, got2.ChangeRequired)
	require.Zero(t, got2.FailedAttempts)
	require.Nil(t, got2.LastSuccessfulCheck)

	list, err := repo.List(ctx, tx, database.WithCondition(repo.ProjectIDCondition(pid)))
	require.NoError(t, err)
	require.Len(t, list, 1)
}

func TestUserTOTPRepository_CRUD(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserTOTPRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-cred-totp"
		tid       = "team-cred-totp"
		schemaURL = "https://schemas.test/cred-totp.json"
		userID    = "usr_totp"
	)

	insertProjectTeamSchemaUser(t, tx, pid, tid, schemaURL, userID)

	secret := []byte{0x01, 0x02, 0xab}
	require.NoError(t, repo.Create(ctx, tx, &domain.CreateUserTOTP{
		ProjectID: pid,
		UserID:    userID,
		Secret:    secret,
	}))

	got, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.NoError(t, err)
	require.Positive(t, got.ID)
	require.Equal(t, pid, got.ProjectID)
	require.Equal(t, userID, got.UserID)
	require.Equal(t, secret, got.Secret)

	byID, err := repo.Get(ctx, tx, database.WithCondition(repo.PrimaryKeyCondition(got.ID)))
	require.NoError(t, err)
	require.Equal(t, got.ID, byID.ID)

	require.NoError(t, repo.Delete(ctx, tx, repo.PrimaryKeyCondition(got.ID)))
	_, err = repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))

	require.NoError(t, repo.Create(ctx, tx, &domain.CreateUserTOTP{
		ProjectID: pid,
		UserID:    userID,
		Secret:    secret,
	}))
	got2, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.NoError(t, err)
	require.Positive(t, got2.ID)
	require.NoError(t, repo.Delete(ctx, tx, repo.UniqueCondition(pid, userID)))
	_, err = repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestUserPasskeyRepository_CRUD(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserPasskeyRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-cred-pk"
		tid       = "team-cred-pk"
		schemaURL = "https://schemas.test/cred-pk.json"
		userID    = "usr_pk"
	)

	insertProjectTeamSchemaUser(t, tx, pid, tid, schemaURL, userID)

	credStr := "cred_pk_test_01"
	now := time.Now().UTC().Truncate(time.Microsecond)
	require.NoError(t, repo.Create(ctx, tx, &domain.CreateUserPasskey{
		ProjectID:       pid,
		UserID:          userID,
		CredentialID:    credStr,
		PublicKey:       []byte{1, 2, 3},
		AAGUID:          []byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1},
		AttestationType: gu.Ptr("packed"),
		Transports:      []string{"internal"},
		SignCount:       3,
		BackupEligible:  true,
		BackupState:     false,
		Name:            "primary",
		VerifiedAt:      &now,
	}))

	got, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID, credStr)))
	require.NoError(t, err)
	require.Positive(t, got.ID)
	require.Equal(t, credStr, got.CredentialID)
	require.Equal(t, []byte{1, 2, 3}, got.PublicKey)
	require.Equal(t, int64(3), got.SignCount)
	require.Equal(t, "primary", got.Name)
	require.NotNil(t, got.VerifiedAt)
	require.True(t, got.VerifiedAt.Equal(now))

	byID, err := repo.Get(ctx, tx, database.WithCondition(repo.PrimaryKeyCondition(got.ID)))
	require.NoError(t, err)
	require.Equal(t, got.ID, byID.ID)

	list, err := repo.List(ctx, tx, database.WithCondition(repo.UserIDCondition(userID)))
	require.NoError(t, err)
	require.Len(t, list, 1)

	require.NoError(t, repo.Delete(ctx, tx, repo.PrimaryKeyCondition(got.ID)))
	_, err = repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID, credStr)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))

	require.NoError(t, repo.Create(ctx, tx, &domain.CreateUserPasskey{
		ProjectID:       pid,
		UserID:          userID,
		CredentialID:    credStr,
		PublicKey:       []byte{1, 2, 3},
		AAGUID:          []byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1},
		AttestationType: gu.Ptr("packed"),
		Transports:      []string{"internal"},
		SignCount:       3,
		BackupEligible:  true,
		BackupState:     false,
		Name:            "primary",
		VerifiedAt:      &now,
	}))
	got2, err := repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID, credStr)))
	require.NoError(t, err)
	require.Positive(t, got2.ID)
	require.NoError(t, repo.Delete(ctx, tx, repo.UniqueCondition(pid, userID, credStr)))
	_, err = repo.Get(ctx, tx, database.WithCondition(repo.UniqueCondition(pid, userID, credStr)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}
