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
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	v2dbtest "github.com/zitadel/nextgen/internal/storage/v2/dbtest"
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, stop, err := v2dbtest.Postgres(ctx)
	if err != nil {
		panic(err)
	}
	defer stop()
	defer pool.Close(ctx)

	testV2ServiceDB = service.NewPool(pool)
	os.Exit(m.Run())
}

var testV2ServiceDB *service.DB

func testV2Pool(t *testing.T) *service.DB {
	t.Helper()
	require.NotNil(t, testV2ServiceDB)
	return testV2ServiceDB
}

func TestImport_loadAndSkip(t *testing.T) {
	ctx := t.Context()
	hasher := testHasher(t)
	v2Pool := testV2Pool(t)

	dir := t.TempDir()
	path := filepath.Join(dir, "user.json")
	writeUserFile(t, path, "usr_import_1")

	require.NoError(t, users.Import(ctx, v2Pool, hasher, "postgres", []string{path}))

	got, err := v2Pool.Statements().GetUser(ctx, v2database.And(
		v2database.Equal(v2database.Col(domain.UserFieldProjectID), "proj_demo"),
		v2database.Equal(v2database.Col(domain.UserFieldID), "usr_import_1"),
	), service.UserQueryOptions{
		AttributeKeys: []string{"username"},
	})
	require.NoError(t, err)
	require.Equal(t, "usr_import_1", got.ID)

	pw, err := v2Pool.Statements().GetUserPassword(ctx, v2database.And(
		v2database.Equal(v2database.Col(domain.UserPasswordFieldProjectID), "proj_demo"),
		v2database.Equal(v2database.Col(domain.UserPasswordFieldUserID), "usr_import_1"),
	))
	require.NoError(t, err)
	require.NotEmpty(t, pw.EncodedHash)

	require.NoError(t, users.Import(ctx, v2Pool, hasher, "postgres", []string{path}))
}

func TestImport_spannerRejected(t *testing.T) {
	err := users.Import(t.Context(), testV2Pool(t), testHasher(t), "spanner", []string{"any.json"})
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
