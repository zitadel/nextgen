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
	_, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (id, name) VALUES ($1, $2)`, dbTable("projects")), pid, "project-"+pid)
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
