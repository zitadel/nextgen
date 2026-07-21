//go:build postgres_integration

package users_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	pgold "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	connector, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		panic(err)
	}
	defer stop()

	pool_, err := connector.Connect(ctx)
	if err != nil {
		panic(err)
	}
	testPool = pool_.(database.PoolTest)
	if err := testPool.MigrateTest(ctx); err != nil {
		panic(err)
	}
	defer testPool.Close(ctx)

	os.Exit(m.Run())
}

var testPool database.PoolTest

func testV2Pool(t *testing.T) *service.DB {
	t.Helper()
	var pgxPool *pgxpool.Pool
	switch p := testPool.(type) {
	case *embedded.Pool:
		pgxPool = p.Pool.Pool
	case *pgold.Pool:
		pgxPool = p.Pool
	default:
		t.Fatalf("unsupported pool type %T", testPool)
	}
	v2, err := (&v2postgres.PoolConfig{Pool: pgxPool}).Connect(t.Context())
	require.NoError(t, err)
	return service.NewPool(v2.(service.Pool))
}

func TestImport_loadAndSkip(t *testing.T) {
	ctx := t.Context()
	hasher := testHasher(t)
	v2Pool := testV2Pool(t)

	dir := t.TempDir()
	path := filepath.Join(dir, "user.json")
	writeUserFile(t, path, "usr_import_1")

	require.NoError(t, users.Import(ctx, testPool, v2Pool, hasher, pgold.Name, []string{path}))

	got, err := v2Pool.Statements().GetUserByID(ctx, "proj_demo", nil, "usr_import_1", service.UserReadOptions{
		AttributeKeys: []string{"username"},
	})
	require.NoError(t, err)
	require.Equal(t, "usr_import_1", got.ID)

	pw, err := v2Pool.Statements().GetUserPasswordByUserID(ctx, "proj_demo", "usr_import_1")
	require.NoError(t, err)
	require.NotEmpty(t, pw.EncodedHash)

	require.NoError(t, users.Import(ctx, testPool, v2Pool, hasher, pgold.Name, []string{path}))
}

func TestImport_spannerRejected(t *testing.T) {
	err := users.Import(t.Context(), testPool, testV2Pool(t), testHasher(t), "spanner", []string{"any.json"})
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
