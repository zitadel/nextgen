//go:build postgres_integration

package users_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		panic(err)
	}
	defer stop()
	defer pool.Close(ctx)

	testServiceDB = service.NewPool(pool)
	os.Exit(m.Run())
}

var testServiceDB *service.DB

func testPool(t *testing.T) *service.DB {
	t.Helper()
	require.NotNil(t, testServiceDB)
	return testServiceDB
}

func TestImport_loadAndSkip(t *testing.T) {
	ctx := t.Context()
	hasher := testHasher(t)
	v2Pool := testPool(t)

	dir := t.TempDir()
	path := filepath.Join(dir, "user.json")
	writeUserFile(t, path, "usr_import_1")

	require.NoError(t, users.Import(ctx, v2Pool, hasher, "postgres", []string{path}))

	got, err := v2Pool.Statements().GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), "proj_demo"),
		database.Equal(database.Col(domain.UserFieldID), "usr_import_1"),
	), service.UserQueryOptions{
		AttributeKeys: []string{"username"},
	})
	require.NoError(t, err)
	require.Equal(t, "usr_import_1", got.ID)

	pw, err := v2Pool.Statements().GetUserPassword(ctx, database.And(
		database.Equal(database.Col(domain.UserPasswordFieldProjectID), "proj_demo"),
		database.Equal(database.Col(domain.UserPasswordFieldUserID), "usr_import_1"),
	))
	require.NoError(t, err)
	require.NotEmpty(t, pw.EncodedHash)

	require.NoError(t, users.Import(ctx, v2Pool, hasher, "postgres", []string{path}))
}

func TestImport_spannerRejected(t *testing.T) {
	err := users.Import(t.Context(), testPool(t), testHasher(t), "spanner", []string{"any.json"})
	require.Error(t, err)
	require.Contains(t, err.Error(), "spanner")
}

func writeUserFile(t *testing.T, path, userID string) {
	t.Helper()
	doc := validDocument()
	doc.Header.ID = userID
	raw, err := json.Marshal(doc)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, raw, 0o600))
}
