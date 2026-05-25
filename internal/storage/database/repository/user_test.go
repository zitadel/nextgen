package repository_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestUserRepository_CreateGetListDelete(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-user-repo"
		tid       = "team-user-repo"
		schemaURL = "https://schemas.test/users/v1.json"
		userID    = "usr_aaa"
	)

	_, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (id) VALUES ($1)`, dbTable("projects")), pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (project_id, id) VALUES ($1,$2)`, dbTable("teams")), pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO %s (project_id, url, payload) VALUES ($1,$2,$3%s)`, dbTable("json_schemas"), jsonCast()),
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	attr1, err := domain.NewCreateAttribute("country", "CH", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	attr2, err := domain.NewCreateAttribute("nickname", "n1", domain.AttributeUniquenessTeam)
	require.NoError(t, err)

	teamCopy := tid
	create := &domain.CreateUser{
		ProjectID:  pid,
		SchemaURL:  schemaURL,
		ID:         userID,
		TeamID:     &teamCopy,
		Attributes: []*domain.CreateAttribute{attr1, attr2},
	}
	require.NoError(t, repo.Create(ctx, tx, create))

	got, err := repo.Get(ctx, tx,
		database.WithCondition(repo.PrimaryKeyCondition(pid, userID)),
		repo.WithAttributes(),
	)
	require.NoError(t, err)
	require.Equal(t, pid, got.ProjectID)
	require.Equal(t, userID, got.ID)
	require.Equal(t, schemaURL, got.SchemaURL)
	require.NotNil(t, got.TeamID)
	require.Equal(t, tid, *got.TeamID)
	require.Len(t, got.Attributes, 2)

	countryLit, err := json.Marshal("CH")
	require.NoError(t, err)
	users, err := repo.List(ctx, tx,
		repository.WithUserScalarList(pid, []repository.UserListScalarFilter{
			{Key: "country", Value: countryLit},
		}, nil),
		repo.WithAttributes("country"),
	)
	require.NoError(t, err)
	require.Len(t, users, 1)
	require.Len(t, users[0].Attributes, 1)
	require.Equal(t, "country", users[0].Attributes[0].Key)

	allByProject, err := repo.List(ctx, tx,
		database.WithCondition(repo.ProjectIDCondition(pid)),
	)
	require.NoError(t, err)
	require.Len(t, allByProject, 1)

	require.NoError(t, repo.Delete(ctx, tx, repo.PrimaryKeyCondition(pid, userID)))

	_, err = repo.Get(ctx, tx,
		database.WithCondition(repo.PrimaryKeyCondition(pid, userID)),
	)
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}
