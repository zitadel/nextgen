package repository_test

import (
	"encoding/json"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestJSONSchemaRepository_CRUD(t *testing.T) {
	repo := repository.NewJSONSchemaRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()

	instanceID := "inst-crud"
	_, err := tx.Exec(t.Context(), "INSERT INTO zitadel_nextgen.instances (id) VALUES ($1)", instanceID)
	require.NoError(t, err)

	schema := &domain.JSONSchema{
		InstanceID: instanceID,
		URL:        "https://example.com/schemas/user.v1.json",
		Schema:     testJSONSchema(t),
	}
	err = repo.Create(t.Context(), tx, schema)
	require.NoError(t, err)

	got, err := repo.Get(t.Context(), tx, database.WithCondition(repo.PrimaryKeyCondition(instanceID, schema.URL)))
	require.NoError(t, err)
	require.Equal(t, instanceID, got.InstanceID)
	require.Equal(t, schema.URL, got.URL)
	require.NotZero(t, got.CreatedAt)
	require.NotNil(t, got.Schema)
	gotSchemaRaw, err := json.Marshal(got.Schema)
	require.NoError(t, err)
	require.Contains(t, string(gotSchemaRaw), `"type":"object"`)

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
	repo := repository.NewJSONSchemaRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()

	err := repo.Delete(t.Context(), tx, repo.InstanceIDCondition("only-instance"))
	require.ErrorIs(t, err, new(database.MissingConditionError))
}

func testJSONSchema(t *testing.T) *jsonschema.Schema {
	t.Helper()
	var schema jsonschema.Schema
	err := json.Unmarshal([]byte(`{"type":"object","properties":{"name":{"type":"string"}}}`), &schema)
	require.NoError(t, err)
	return &schema
}
