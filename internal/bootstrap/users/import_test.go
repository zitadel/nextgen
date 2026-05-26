package users_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	connector, stop, err := embedded.StartEmbedded()
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

func TestImport_loadAndSkip(t *testing.T) {
	ctx := t.Context()
	hasher := testHasher(t)

	dir := t.TempDir()
	path := filepath.Join(dir, "user.json")
	writeUserFile(t, path, "usr_import_1")

	require.NoError(t, users.Import(ctx, testPool, hasher, postgres.Name, []string{path}))

	userRepo := repository.NewUserRepository()
	got, err := userRepo.Get(ctx, testPool,
		database.WithCondition(userRepo.PrimaryKeyCondition("proj_demo", "usr_import_1")),
		userRepo.WithAttributes("username"),
	)
	require.NoError(t, err)
	require.Equal(t, "usr_import_1", got.ID)

	pwRepo := repository.NewUserPasswordRepository()
	pw, err := pwRepo.Get(ctx, testPool,
		database.WithCondition(pwRepo.UniqueCondition("proj_demo", "usr_import_1")),
	)
	require.NoError(t, err)
	require.NotEmpty(t, pw.EncodedHash)

	require.NoError(t, users.Import(ctx, testPool, hasher, postgres.Name, []string{path}))
}

func TestImport_spannerRejected(t *testing.T) {
	err := users.Import(t.Context(), testPool, testHasher(t), "spanner", []string{"any.json"})
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
