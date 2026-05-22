package repository_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestJSONSchemaRepository_CRUD(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	repo := repository.NewJSONSchemaRepository(tx)
	defer rollback()

	projectID := "proj-crud"
	ensureProject(t, tx, projectID)

	schema := &domain.JSONSchema{
		ProjectID: projectID,
		URL:       "https://example.com/schemas/user.v1.json",
		Schema:    []byte(`{"type":"object","properties":{"name":{"type":"string"}}}`),
	}
	err := repo.Create(t.Context(), tx, schema)
	require.NoError(t, err)

	got, err := repo.Get(t.Context(), tx, database.WithCondition(repo.PrimaryKeyCondition(projectID, schema.URL)))
	require.NoError(t, err)
	require.Equal(t, projectID, got.ProjectID)
	require.Equal(t, schema.URL, got.URL)
	require.NotZero(t, got.CreatedAt)
	require.NotNil(t, got.Schema)
	require.NoError(t, err)
	require.Contains(t, string(got.Schema), `"type":"object"`)

	list, err := repo.List(t.Context(), tx, database.WithCondition(repo.ProjectIDCondition(projectID)))
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, schema.URL, list[0].URL)

	err = repo.Delete(t.Context(), tx, repo.PrimaryKeyCondition(projectID, schema.URL))
	require.NoError(t, err)

	_, err = repo.Get(t.Context(), tx, database.WithCondition(repo.PrimaryKeyCondition(projectID, schema.URL)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestJSONSchemaRepository_DeleteRequiresPK(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	repo := repository.NewJSONSchemaRepository(tx)
	defer rollback()

	err := repo.Delete(t.Context(), tx, repo.ProjectIDCondition("only-project"))
	require.ErrorIs(t, err, new(database.MissingConditionError))
}
