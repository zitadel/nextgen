//go:build postgres_integration || spanner_integration

package users_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
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

// testBuiltinBases is the built-in namespace every import here runs under: a
// canonical base of its own, aliased by every base a real deployment knows.
var testBuiltinBases = domain.BuiltinSchemaBasesFor("https://schemas.test/builtin/v1")

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
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	path := writeUserFile(t, projectID, "team_"+suffix, userID)

	require.NoError(t, users.Import(ctx, v2Pool, hasher, "postgres", testBuiltinBases, []string{path}))

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

	require.NoError(t, users.Import(ctx, v2Pool, hasher, "postgres", testBuiltinBases, []string{path}))
}

// Replicas that start together all import the same document: on a serverless
// platform a cold burst brings up one process per request. Every one of them
// must start, and the user exists once.
func TestImport_concurrentReplicas(t *testing.T) {
	ctx := t.Context()
	hasher := testHasher(t)
	v2Pool := testPool(t)
	stmts := v2Pool.Statements()

	suffix := rand.Text()
	projectID := "proj_" + suffix
	userID := "user_" + suffix
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	path := writeUserFile(t, projectID, "team_"+suffix, userID)

	const replicas = 8
	errs := make(chan error, replicas)
	start := make(chan struct{})
	for range replicas {
		go func() {
			<-start
			errs <- users.Import(ctx, v2Pool, hasher, "postgres", testBuiltinBases, []string{path})
		}()
	}
	close(start)
	for range replicas {
		require.NoError(t, <-errs)
	}

	got, err := stmts.GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserFieldID), userID),
	), service.UserQueryOptions{})
	require.NoError(t, err)
	require.Equal(t, userID, got.ID)
}

func TestImport_spannerRejected(t *testing.T) {
	err := users.Import(t.Context(), testPool(t), testHasher(t), "spanner", testBuiltinBases, []string{"any.json"})
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
		ID:      projectID,
		Name:    "project-" + projectID,
		Origins: []domain.Origin{},
	}))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

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
	err := users.Import(ctx, v2Pool, testHasher(t), "postgres", testBuiltinBases, []string{path})
	require.Error(t, err)
	require.Contains(t, err.Error(), `ensure team "`+teamID+`"`)
	require.Contains(t, err.Error(), "uq_teams_project_name")
}

// A user schema that identifies users by `email` must see the imported user's
// email in the unique-attributes registry, or sign-in cannot resolve them.
func TestImport_uniqueAttributesFollowSchema(t *testing.T) {
	ctx := t.Context()
	v2Pool := testPool(t)
	stmts := v2Pool.Statements()

	suffix := rand.Text()
	projectID := "proj_" + suffix
	userID := "user_" + suffix
	require.NoError(t, stmts.CreateProject(ctx, &domain.Project{
		ID:      projectID,
		Name:    "project-" + projectID,
		Origins: []domain.Origin{},
	}))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	doc := validDocument()
	doc.Header.ProjectID = projectID
	doc.Header.TeamID = "team_" + suffix
	doc.Header.ID = userID
	doc.Attributes["email"] = json.RawMessage(`"admin-` + suffix + `@example.com"`)
	require.NoError(t, stmts.CreateJSONSchema(ctx, &domain.JSONSchema{
		ProjectID: projectID,
		URL:       doc.Header.SchemaURL,
		Kind:      domain.JSONSchemaKindUnknown,
		Schema: []byte(`{"type":"object","properties":{` +
			`"email":{"type":"string","x-unique":"project"}}}`),
	}))
	raw, err := json.Marshal(doc)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "user.json")
	require.NoError(t, os.WriteFile(path, raw, 0o600))

	require.NoError(t, users.Import(ctx, v2Pool, testHasher(t), "postgres", testBuiltinBases, []string{path}))

	scopes, err := stmts.GetUserUniqueAttributeScopes(ctx, projectID, userID)
	require.NoError(t, err)
	require.Contains(t, scopes, domain.AttributeKey("email"))
	require.Contains(t, scopes, domain.AttributeKey("username"))
}

// A bootstrap document minted while the built-in schemas lived under a legacy
// base meets a project seeded under the current one: the user must point at
// the seeded schema, or sign-in cannot resolve them by email.
func TestImport_legacySchemaURLUsesSeededRow(t *testing.T) {
	ctx := t.Context()
	v2Pool := testPool(t)
	stmts := v2Pool.Statements()

	suffix := rand.Text()
	projectID := "proj_" + suffix
	userID := "user_" + suffix
	require.NoError(t, stmts.CreateProject(ctx, &domain.Project{
		ID:      projectID,
		Name:    "project-" + projectID,
		Origins: []domain.Origin{},
	}))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	seededURL := testBuiltinBases.Canonical() + "/default-human-user.json"
	legacyURL := "https://nextgen.com/api/schemas/default-human-user.json"
	require.NoError(t, stmts.CreateJSONSchema(ctx, &domain.JSONSchema{
		ProjectID: projectID,
		URL:       seededURL,
		Kind:      domain.JSONSchemaKindUnknown,
		Schema: []byte(`{"type":"object","properties":{` +
			`"email":{"type":"string","x-unique":"project"}}}`),
	}))

	doc := validDocument()
	doc.Header.ProjectID = projectID
	doc.Header.TeamID = "team_" + suffix
	doc.Header.ID = userID
	doc.Header.SchemaURL = legacyURL
	doc.Attributes["email"] = json.RawMessage(`"admin-` + suffix + `@example.com"`)
	raw, err := json.Marshal(doc)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "user.json")
	require.NoError(t, os.WriteFile(path, raw, 0o600))

	require.NoError(t, users.Import(ctx, v2Pool, testHasher(t), "postgres", testBuiltinBases, []string{path}))

	got, err := stmts.GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserFieldID), userID),
	), service.UserQueryOptions{})
	require.NoError(t, err)
	require.Equal(t, seededURL, got.SchemaURL)

	scopes, err := stmts.GetUserUniqueAttributeScopes(ctx, projectID, userID)
	require.NoError(t, err)
	require.Contains(t, scopes, domain.AttributeKey("email"))

	_, err = stmts.GetJSONSchemaByID(ctx, projectID, legacyURL)
	_, missing := errors.AsType[*database.NoRowFoundError](err)
	require.True(t, missing, "no placeholder may be created under the legacy URL, got %v", err)
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
