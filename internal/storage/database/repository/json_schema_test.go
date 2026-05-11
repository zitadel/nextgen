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

	instanceID := "inst-crud"
	ensureProject(t, tx, instanceID)

	schema := &domain.JSONSchema{
		InstanceID: instanceID,
		URL:        "https://example.com/schemas/user.v1.json",
		Schema:     []byte(`{"type":"object","properties":{"name":{"type":"string"}}}`),
	}
	err := repo.Create(t.Context(), tx, schema)
	require.NoError(t, err)

	got, err := repo.Get(t.Context(), tx, database.WithCondition(repo.PrimaryKeyCondition(instanceID, schema.URL)))
	require.NoError(t, err)
	require.Equal(t, instanceID, got.InstanceID)
	require.Equal(t, schema.URL, got.URL)
	require.NotZero(t, got.CreatedAt)
	require.NotNil(t, got.Schema)
	require.Contains(t, string(got.Schema), `"type":"object"`)

	list, err := repo.List(t.Context(), tx, database.WithCondition(repo.InstanceIDCondition(instanceID)))
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, schema.URL, list[0].URL)

	err = repo.Delete(t.Context(), tx, repo.PrimaryKeyCondition(instanceID, schema.URL))
	require.NoError(t, err)

	_, err = repo.Get(t.Context(), tx, database.WithCondition(repo.PrimaryKeyCondition(instanceID, schema.URL)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestJSONSchemaRepository_DeleteRequiresPK(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	repo := repository.NewJSONSchemaRepository(tx)
	defer rollback()

	err := repo.Delete(t.Context(), tx, repo.InstanceIDCondition("only-instance"))
	require.ErrorIs(t, err, new(database.MissingConditionError))
}
