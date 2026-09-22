//go:build configfs_integration

package configfs_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/configfs"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite"
)

// These exercise the store through a real pool against a real database, rather
// than against a mocked SQL half. What that buys over the unit tests is the
// part the unit tests cannot reach: that a configuration write really does land
// its resource-scope row in SQL, that a rollback really does take that row with
// it, that the routing holds when both halves are live, and that a SQL-backed
// resource in the same transaction is unaffected.

const testProject = "proj_configfs_integration"

func schemaDoc(objectType, title string) []byte {
	return []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/` + objectType + `.json",
  "objectType": "` + objectType + `",
  "kind": "user-schema",
  "title": "` + title + `",
  "type": "object",
  "x-identifier": "email",
  "required": ["email"],
  "properties": {"email": {"type": "string", "format": "email"}}
}`)
}

func flowDoc(name, firstStep string) []byte {
	return []byte(`{
  "name": "` + name + `",
  "status": "active",
  "user_schema": "https://example.com/schemas/human-user.json",
  "purposes": {"login": "` + firstStep + `"},
  "steps": [{"name": "` + firstStep + `", "fields": ["email"]}]
}`)
}

// newPool brings up a migrated SQLite database and a project directory, joined
// by the pool under test. The project row is created for real, because the
// resource-scope rows a configuration write produces reference it.
func newPool(t *testing.T) (*configfs.Pool, string) {
	t.Helper()
	ctx := t.Context()

	dbDir := t.TempDir()
	sqlPool, err := sqlite.Config{Path: filepath.Join(dbDir, "test.db")}.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlPool.Close(context.Background()) })
	require.NoError(t, sqlPool.Migrate(ctx))

	typed, ok := sqlPool.(configfs.SQLPool)
	require.True(t, ok, "the sqlite pool serves both halves of the interface")

	require.NoError(t, typed.Statements().CreateProject(ctx, &domain.Project{ID: testProject, Name: "configfs"}))

	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "zitadel.json"),
		[]byte(`{"project":"`+testProject+`"}`), 0o600))

	store, err := configfs.NewStore(ctx, root)
	require.NoError(t, err)

	pool := configfs.NewPool(typed, store)
	t.Cleanup(func() { _ = store.Close() })
	return pool, root
}

func writeDoc(t *testing.T, root, dir, name string, content []byte) string {
	t.Helper()
	full := filepath.Join(root, ".zitadel", dir)
	require.NoError(t, os.MkdirAll(full, 0o700))
	path := filepath.Join(full, name+".json")
	require.NoError(t, os.WriteFile(path, content, 0o600))
	return path
}

func unrestricted(t *testing.T) context.Context {
	t.Helper()
	return service.WithAuthzListUnrestricted(t.Context())
}

// A document dropped into the tree is served by the pool, and an edit to it is
// served by the next read. This is the feature, end to end over real storage.
func TestPoolServesTheTreeAndFollowsEdits(t *testing.T) {
	pool, root := newPool(t)
	ctx := unrestricted(t)

	path := writeDoc(t, root, "schemas", "human-user", schemaDoc("human-user", "First"))

	got, err := pool.Statements().GetJSONSchemaByID(ctx, testProject,
		"https://example.com/schemas/human-user.json")
	require.NoError(t, err)
	assert.Contains(t, string(got.Schema), "First")

	require.NoError(t, os.WriteFile(path, schemaDoc("human-user", "Second"), 0o600))

	got, err = pool.Statements().GetJSONSchemaByID(ctx, testProject,
		"https://example.com/schemas/human-user.json")
	require.NoError(t, err)
	assert.Contains(t, string(got.Schema), "Second")
}

// A configuration write has a SQL half. Without the scope row a by-id
// management gate cannot resolve which project the path id belongs to, so the
// resource would be unreadable through the API however well the file parses.
func TestConfigWriteLandsItsScopeRowInSQL(t *testing.T) {
	pool, root := newPool(t)
	ctx := t.Context()

	schema, err := domain.NewJSONSchema(testProject, schemaDoc("human-user", "Created"))
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateJSONSchema(ctx, schema))

	// The document is in the tree...
	onDisk, err := os.ReadFile(filepath.Join(root, ".zitadel", "schemas", "human-user.json"))
	require.NoError(t, err)
	assert.Contains(t, string(onDisk), "Created")

	// ...and the row that makes it addressable is in the database.
	scope, err := pool.Statements().GetResourceScopeInProject(ctx,
		domain.ResourceKindSchema, testProject, schema.URL)
	require.NoError(t, err)
	assert.Equal(t, testProject, scope.ProjectID)
	assert.Equal(t, domain.ResourceKindSchema, scope.ResourceKind)

	// And a delete takes both away again.
	require.NoError(t, pool.Statements().DeleteJSONSchemaByID(ctx, testProject, schema.URL))
	_, err = os.Stat(filepath.Join(root, ".zitadel", "schemas", "human-user.json"))
	assert.True(t, os.IsNotExist(err), "the document is gone from the tree")
	_, err = pool.Statements().GetResourceScopeInProject(ctx,
		domain.ResourceKindSchema, testProject, schema.URL)
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

// The honest boundary of this storage split, pinned rather than left to be
// discovered: a rollback takes the SQL half back and leaves the file. The tree
// is the source of truth for content, so the file is what the next read serves;
// the scope row is what was lost.
func TestRollbackUndoesTheSQLHalfOnly(t *testing.T) {
	pool, root := newPool(t)
	ctx := t.Context()

	schema, err := domain.NewJSONSchema(testProject, schemaDoc("human-user", "Doomed"))
	require.NoError(t, err)

	sentinel := assertError("rolled back")
	err = pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		if err := tx.Statements().CreateJSONSchema(ctx, schema); err != nil {
			return err
		}
		return sentinel
	})
	require.ErrorIs(t, err, sentinel)

	_, err = os.ReadFile(filepath.Join(root, ".zitadel", "schemas", "human-user.json"))
	require.NoError(t, err, "the file write is outside the transaction and survives it")

	_, err = pool.Statements().GetResourceScopeInProject(ctx,
		domain.ResourceKindSchema, testProject, schema.URL)
	require.ErrorIs(t, err, new(database.NoRowFoundError),
		"the SQL half rolled back with the transaction")
}

// Inside one transaction, a configuration kind goes to the tree and a
// SQL-backed kind goes to the database. The routing is per method, so this is
// what proves the two halves coexist rather than one shadowing the other.
func TestBothHalvesInOneTransaction(t *testing.T) {
	pool, root := newPool(t)
	ctx := t.Context()

	teamID := ""
	require.NoError(t, pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		schema, err := domain.NewJSONSchema(testProject, schemaDoc("human-user", "Together"))
		if err != nil {
			return err
		}
		if err := tx.Statements().CreateJSONSchema(ctx, schema); err != nil {
			return err
		}
		team := &domain.Team{ProjectID: testProject, Name: "configfs-team"}
		if err := tx.Statements().CreateTeam(ctx, team); err != nil {
			return err
		}
		teamID = team.ID
		return nil
	}))

	// The configuration kind is a file.
	_, err := os.Stat(filepath.Join(root, ".zitadel", "schemas", "human-user.json"))
	require.NoError(t, err)

	// The SQL kind is a row, and it was committed by the same transaction.
	team, err := pool.Statements().GetTeam(ctx,
		database.And(
			database.Equal(database.Col(domain.TeamFieldProjectID), testProject),
			database.Equal(database.Col(domain.TeamFieldID), teamID),
		))
	require.NoError(t, err)
	assert.Equal(t, "configfs-team", team.Name)
}

// A list still fails closed against a real database, and still narrows to the
// ids the resolver answers with. The unit tests mock that answer; here the
// predicate runs against real assignment and scope tables.
func TestListAuthorizationHoldsAgainstRealSQL(t *testing.T) {
	pool, root := newPool(t)
	writeDoc(t, root, "schemas", "human-user", schemaDoc("human-user", "H"))

	_, err := pool.Statements().ListJSONSchemas(t.Context(),
		&database.ListOptions[domain.JSONSchemaField]{Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), testProject)}, service.JSONSchemaQueryOptions{})
	require.ErrorIs(t, err, service.ErrListFilterRequired,
		"a management list with no authorization filter must not reach the tree")

	res, err := pool.Statements().ListJSONSchemas(unrestricted(t),
		&database.ListOptions[domain.JSONSchemaField]{Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), testProject)}, service.JSONSchemaQueryOptions{})
	require.NoError(t, err)
	assert.Len(t, res.Items, 1, "an unrestricted caller sees the tree")
}

// Everything that is not a configuration kind reaches the database untouched.
func TestNonConfigKindsReachSQL(t *testing.T) {
	pool, _ := newPool(t)

	project, err := pool.Statements().GetProjectByID(t.Context(), testProject)
	require.NoError(t, err)
	assert.Equal(t, testProject, project.ID)
}

// Flows and branding travel the same route as schemas.
func TestFlowsAndBrandingServeFromTheTree(t *testing.T) {
	pool, root := newPool(t)
	ctx := unrestricted(t)

	writeDoc(t, root, "flows", "default-login", flowDoc("default-login", "identifier"))
	writeDoc(t, root, "branding", "branding", []byte(`{"layout":"centered"}`))

	flow, err := pool.Statements().GetFlowDefinitionByID(ctx, testProject, "default-login")
	require.NoError(t, err)
	assert.Equal(t, "default-login", flow.Name)
	require.Len(t, flow.Steps, 1)

	brand, err := pool.Statements().GetBrandingByID(ctx, testProject, "default")
	require.NoError(t, err)
	assert.Equal(t, "centered", brand.Layout)
}

// assertError is a sentinel for the rollback test.
type assertError string

func (e assertError) Error() string { return string(e) }

// TestUnservedProjectsFallThroughToSQL is the bug the journey caught: the
// server bootstraps a platform project of its own at startup, which writes a
// default schema. That project is not the one the tree holds, and rejecting
// its write killed the server before it became healthy.
//
// A tree serves exactly one project. Every other project — the platform one,
// and any project on a server that also hosts others — belongs to SQL, and has
// to reach it rather than meet an error.
func TestUnservedProjectsFallThroughToSQL(t *testing.T) {
	pool, root := newPool(t)
	ctx := t.Context()

	const other = "proj_platform"
	require.NoError(t, pool.Statements().CreateProject(ctx, &domain.Project{ID: other, Name: "platform"}))

	schema, err := domain.NewJSONSchema(other, schemaDoc("human-user", "Platform"))
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateJSONSchema(ctx, schema),
		"a write for another project must be accepted, by SQL")

	// It went to the database, not the tree.
	_, err = os.Stat(filepath.Join(root, ".zitadel", "schemas", "human-user.json"))
	assert.True(t, os.IsNotExist(err), "another project's schema does not land in this tree")

	got, err := pool.Statements().GetJSONSchemaByID(ctx, other, schema.URL)
	require.NoError(t, err, "and it reads back from SQL")
	assert.Equal(t, other, got.ProjectID)

	// The tree's own project still reads from the tree.
	writeDoc(t, root, "schemas", "human-user", schemaDoc("human-user", "Ours"))
	ours, err := pool.Statements().GetJSONSchemaByID(ctx, testProject,
		"https://example.com/schemas/human-user.json")
	require.NoError(t, err)
	assert.Contains(t, string(ours.Schema), "Ours")
}

// Before setup has run the tree names no project, so nothing is served and
// every project — including the platform bootstrap — must reach SQL. This is
// the exact startup ordering `zitadel start` produces.
func TestBeforeSetupEverythingReachesSQL(t *testing.T) {
	ctx := t.Context()

	dbDir := t.TempDir()
	sqlPool, err := sqlite.Config{Path: filepath.Join(dbDir, "test.db")}.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlPool.Close(context.Background()) })
	require.NoError(t, sqlPool.Migrate(ctx))
	typed, ok := sqlPool.(configfs.SQLPool)
	require.True(t, ok)

	// A project directory with no zitadel.json: `start` runs before `setup`.
	root := t.TempDir()
	store, err := configfs.NewStore(ctx, root)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	pool := configfs.NewPool(typed, store)

	require.NoError(t, pool.Statements().CreateProject(ctx,
		&domain.Project{ID: "proj_platform", Name: "platform"}))
	schema, err := domain.NewJSONSchema("proj_platform", schemaDoc("human-user", "Bootstrap"))
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateJSONSchema(ctx, schema),
		"the platform bootstrap must succeed on a tree that has not been set up")
}

// TestCreateWithoutAnIDMintsOne is the second journey failure: `zitadel setup`
// uploads its schema with no `$id`, expecting the dialect to assign one, the
// way every create path in the repository does (ADR 047). Skipping that handed
// the resource-scope index an empty resource_id, and the integrity violation
// came back to the caller as a bogus 409 conflict.
func TestCreateWithoutAnIDMintsOne(t *testing.T) {
	pool, root := newPool(t)
	ctx := t.Context()

	// A document with no `$id`, exactly as setup uploads it.
	schema, err := domain.NewJSONSchema(testProject, []byte(`{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "objectType": "human-user",
      "kind": "user-schema",
      "type": "object",
      "x-identifier": "email",
      "required": ["email"],
      "properties": {"email": {"type": "string", "format": "email"}}
    }`))
	require.NoError(t, err)
	require.Empty(t, schema.URL, "the fixture really does arrive without an id")

	require.NoError(t, pool.Statements().CreateJSONSchema(ctx, schema))
	assert.NotEmpty(t, schema.URL, "the dialect assigns one")
	assert.True(t, strings.HasPrefix(schema.URL, "sch_"), "and it is a prefixed opaque id: %s", schema.URL)

	// The scope row carries that id, which is what makes the schema readable
	// by path id at all.
	scope, err := pool.Statements().GetResourceScopeInProject(ctx,
		domain.ResourceKindSchema, testProject, schema.URL)
	require.NoError(t, err)
	assert.Equal(t, schema.URL, scope.ResourceID)

	got, err := pool.Statements().GetJSONSchemaByID(ctx, testProject, schema.URL)
	require.NoError(t, err)
	assert.Equal(t, "human-user", *got.ObjectType)

	_ = root
}

// Overwriting is the accepted behaviour for a dev-only store: re-authoring an
// object type replaces its document rather than accumulating revisions. Pinned
// so the data loss is a decision on the record, not a surprise.
func TestSameObjectTypeOverwrites(t *testing.T) {
	pool, _ := newPool(t)
	ctx := t.Context()

	first, err := domain.NewJSONSchema(testProject, schemaDoc("human-user", "First"))
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateJSONSchema(ctx, first))

	second, err := domain.NewJSONSchema(testProject, schemaDoc("human-user", "Second"))
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateJSONSchema(ctx, second))

	got, err := pool.Statements().GetJSONSchemaByID(ctx, testProject, second.URL)
	require.NoError(t, err)
	assert.Contains(t, string(got.Schema), "Second", "the newest document wins")
}

// TestCreateAdoptsTheCLIsDocument is the third journey failure: the CLI writes
// its own copy of a schema before uploading it, under its own file name. A
// create that picked a name from the object type produced a second document
// for the same schema, and once the server stamped the minted id into it both
// files resolved to one id — a list returned the schema twice and a read
// picked whichever came first.
func TestCreateAdoptsTheCLIsDocument(t *testing.T) {
	pool, root := newPool(t)
	ctx := t.Context()

	// The CLI's copy, named its way, with no id yet.
	writeDoc(t, root, "schemas", "default-human-user", []byte(`{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "objectType": "human-user",
      "kind": "user-schema",
      "type": "object",
      "x-identifier": "email",
      "required": ["email"],
      "properties": {"email": {"type": "string", "format": "email"}}
    }`))

	// The upload that follows it.
	schema, err := domain.NewJSONSchema(testProject, schemaDoc("human-user", "Uploaded"))
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateJSONSchema(ctx, schema))

	// One document, not two.
	entries, err := os.ReadDir(filepath.Join(root, ".zitadel", "schemas"))
	require.NoError(t, err)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	assert.Equal(t, []string{"default-human-user.json"}, names,
		"the upload lands in the document the CLI already wrote")

	// And it resolves to exactly one schema.
	res, err := pool.Statements().ListJSONSchemas(unrestricted(t),
		&database.ListOptions[domain.JSONSchemaField]{
			Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), testProject),
		}, service.JSONSchemaQueryOptions{})
	require.NoError(t, err)
	require.Len(t, res.Items, 1, "one schema, not one per file")
	assert.Equal(t, schema.URL, res.Items[0].URL)
}

// TestDocumentsCarryTheirOwnID is the seventh journey failure, and the reason
// it only hit flows: a schema declares its identity as `$id` inside the
// document, so it survives anything. A flow and a branding revision had no such
// field and depended entirely on the CLI's index — which the watcher regularly
// catches mid-write, since the CLI rewrites it on every sync. With an empty
// index the flow fell back to its name, no scope row matched that, and the
// authorized-id filter returned nothing.
//
// A document that states its own id cannot be misidentified by a half-written
// index.
func TestDocumentsCarryTheirOwnID(t *testing.T) {
	pool, root := newPool(t)
	ctx := t.Context()

	writeDoc(t, root, "flows", "seed", flowDoc("seed", "identifier"))
	seeded, err := pool.Statements().GetFlowDefinitionByID(ctx, testProject, "seed")
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateFlowDefinition(ctx, seeded))

	onDisk, err := os.ReadFile(filepath.Join(root, ".zitadel", "flows", "seed.json"))
	require.NoError(t, err)
	assert.Contains(t, string(onDisk), `"id"`, "the flow document states its id")

	// No index at all: the document still knows what it is.
	require.NoError(t, os.RemoveAll(filepath.Join(root, ".zitadel", "state.json")))
	got, err := pool.Statements().GetFlowDefinitionByID(ctx, testProject, seeded.ID)
	require.NoError(t, err, "a flow resolves by id with no index present")
	assert.Equal(t, seeded.ID, got.ID)

	// Branding the same way.
	require.NoError(t, pool.Statements().CreateBranding(ctx, &domain.Branding{
		ProjectID: testProject,
		ID:        "brnd_01CARRIED",
		Layout:    "centered",
	}))
	brand, err := pool.Statements().GetBrandingByID(ctx, testProject, "brnd_01CARRIED")
	require.NoError(t, err, "a branding revision resolves by the id it was created with")
	assert.Equal(t, "centered", brand.Layout)
}
