//go:build postgres_integration || spanner_integration

package users_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
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
	stmts := v2Pool.Statements()

	suffix := rand.Text()
	projectID := "proj_" + suffix
	userID := "user_" + suffix
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	path := writeUserFile(t, projectID, "team_"+suffix, userID)

	require.NoError(t, users.Import(ctx, v2Pool, hasher, "postgres", []string{path}))

	got, err := stmts.GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserFieldID), userID),
	), service.UserQueryOptions{
		AttributeKeys: []string{"username"},
	})
	require.NoError(t, err)
	require.Equal(t, userID, got.ID)

	pw, err := stmts.GetUserPassword(ctx, database.And(
		database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
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

func TestImport_teamPlaceholderNameTaken(t *testing.T) {
	ctx := t.Context()
	v2Pool := testPool(t)
	stmts := v2Pool.Statements()

	suffix := rand.Text()
	projectID := "proj_" + suffix
	teamID := "team_" + suffix

	require.NoError(t, stmts.CreateProject(ctx, &domain.Project{
		ID:             projectID,
		Name:           "project-" + projectID,
		PreviewOrigins: []string{},
	}))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	// The placeholder name is derived from the team ID, so parking it on another
	// team makes the insert fail on the name index instead of the primary key.
	require.NoError(t, stmts.CreateTeam(ctx, &domain.Team{
		ProjectID: projectID,
		ID:        teamID + "_other",
		Name:      "team-" + teamID,
	}))

	path := writeUserFile(t, projectID, teamID, "user_"+suffix)

	// The import fails either way; what matters is that it names the team it
	// could not create, rather than a later team_memberships insert tripping
	// over the missing team's foreign key.
	err := users.Import(ctx, v2Pool, testHasher(t), "postgres", []string{path})
	require.Error(t, err)
	require.Contains(t, err.Error(), `ensure team "`+teamID+`"`)
	require.Contains(t, err.Error(), "uq_teams_project_name")
}

// writeUserFile writes a valid user document carrying the given IDs and returns
// its path.
func writeUserFile(t *testing.T, projectID, teamID, userID string) string {
	t.Helper()
	doc := validDocument()
	doc.Header.ProjectID = projectID
	doc.Header.TeamID = teamID
	doc.Header.ID = userID
	raw, err := json.Marshal(doc)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "user.json")
	require.NoError(t, os.WriteFile(path, raw, 0o600))
	return path
}
