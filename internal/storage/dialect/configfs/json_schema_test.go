package configfs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const testProject = "proj_configfs"

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

// newStatements builds the composite over a mocked SQL half. The SQL calls the
// configuration kinds still make (scope rows, list visibility) are asserted
// where they matter and allowed anywhere else.
func newStatements(t *testing.T) (*Statements, *Store, *servicemocks.MockAllStatements) {
	t.Helper()

	root := t.TempDir()
	// The tree describes itself: zitadel.json names the project the documents
	// belong to, so a store cannot be opened without one.
	require.NoError(t, os.WriteFile(filepath.Join(root, "zitadel.json"),
		[]byte(`{"project":"`+testProject+`"}`), 0o600))

	store, err := NewStore(t.Context(), root)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	sql := servicemocks.NewMockAllStatements(gomock.NewController(t))
	sql.EXPECT().UpsertResourceScope(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	sql.EXPECT().DeleteResourceScope(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	return NewStatements(sql, store), store, sql
}

// writeState writes the CLI's resource index, mapping a resource file to the
// id the server minted for it.
func writeState(t *testing.T, store *Store, resources map[string]string) {
	t.Helper()
	entries := make(map[string]StateResource, len(resources))
	for path, id := range resources {
		entries[path] = StateResource{ID: id}
	}
	raw, err := json.Marshal(StateFile{Resources: entries})
	require.NoError(t, err)

	require.NoError(t, os.MkdirAll(filepath.Join(store.Root(), zitadelDir), 0o700))
	require.NoError(t, os.WriteFile(store.stateFilePath(), raw, 0o600))
	require.NoError(t, store.reloadStateFile())
}

// unrestricted is the context a list needs to pass the #838 tripwire when the
// caller is project-wide authorized.
func unrestricted(t *testing.T) (ctx context.Context) {
	t.Helper()
	return service.WithAuthzListUnrestricted(t.Context())
}

// TestSchemasReadThroughToDisk is the point of this store: a file written by
// the CLI is served by the running server, and editing that file changes what
// the next read returns with no restart, no upload and no cache to invalidate.
func TestSchemasReadThroughToDisk(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	ctx := unrestricted(t)

	path := filepath.Join(store.Root(), schemasDir, "human-user.json")
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
	require.NoError(t, os.WriteFile(path, schemaDoc("human-user", "First"), 0o600))

	got, err := stmts.GetJSONSchemaByID(ctx, testProject, "https://example.com/schemas/human-user.json")
	require.NoError(t, err)
	assert.Equal(t, "human-user", *got.ObjectType)
	assert.Contains(t, string(got.Schema), "First")

	// The edit a developer makes in their editor mid-session.
	require.NoError(t, os.WriteFile(path, schemaDoc("human-user", "Second"), 0o600))

	got, err = stmts.GetJSONSchemaByID(ctx, testProject, "https://example.com/schemas/human-user.json")
	require.NoError(t, err)
	assert.Contains(t, string(got.Schema), "Second", "the next read must serve the edited file")
}

func TestSchemasListFromDisk(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	ctx := unrestricted(t)

	dir := filepath.Join(store.Root(), schemasDir)
	require.NoError(t, os.MkdirAll(dir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "human-user.json"), schemaDoc("human-user", "H"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "machine.json"), schemaDoc("machine", "M"), 0o600))

	res, err := stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{
		Pagination: database.Page[domain.JSONSchemaField]{
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns: []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldURL)},
			},
		},
	}, service.JSONSchemaQueryOptions{})
	require.NoError(t, err)
	require.Len(t, res.Items, 2)
	assert.Equal(t, "https://example.com/schemas/human-user.json", res.Items[0].URL)
	assert.Equal(t, "https://example.com/schemas/machine.json", res.Items[1].URL)

	// A file added after the list, served by the next one.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "device.json"), schemaDoc("device", "D"), 0o600))
	res, err = stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{
		Pagination: database.Page[domain.JSONSchemaField]{
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns: []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldURL)},
			},
		},
	}, service.JSONSchemaQueryOptions{})
	require.NoError(t, err)
	assert.Len(t, res.Items, 3)
}

// A create through the API lands as a file, so the CLI's upload and a hand
// edit converge on the same tree.
func TestSchemaCreateWritesAFile(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)

	schema, err := domain.NewJSONSchema(testProject, schemaDoc("human-user", "Created"))
	require.NoError(t, err)
	require.NoError(t, stmts.CreateJSONSchema(t.Context(), schema))

	onDisk, err := os.ReadFile(store.schemaFilePath("human-user"))
	require.NoError(t, err)
	assert.Contains(t, string(onDisk), "Created")
}

// The #838 tripwire has to hold here too: reaching storage with no
// authorization filter must fail rather than return every schema.
func TestSchemaListFailsClosedWithoutAnAuthzFilter(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	dir := filepath.Join(store.Root(), schemasDir)
	require.NoError(t, os.MkdirAll(dir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "human-user.json"), schemaDoc("human-user", "H"), 0o600))

	_, err := stmts.ListJSONSchemas(t.Context(), &database.ListOptions[domain.JSONSchemaField]{}, service.JSONSchemaQueryOptions{})
	require.ErrorIs(t, err, service.ErrListFilterRequired)
}

// A partially-authorized caller sees only the ids the SQL side says it may,
// even though the content came from files.
func TestSchemaListNarrowsToAuthorizedIDs(t *testing.T) {
	t.Parallel()

	stmts, store, sql := newStatements(t)
	dir := filepath.Join(store.Root(), schemasDir)
	require.NoError(t, os.MkdirAll(dir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "human-user.json"), schemaDoc("human-user", "H"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "machine.json"), schemaDoc("machine", "M"), 0o600))

	sql.EXPECT().
		ListAuthzObjectIDs(gomock.Any(), gomock.Any()).
		Return([]string{"https://example.com/schemas/machine.json"}, nil)

	var filter service.AuthzListFilter
	filter.ProjectID = testProject
	filter.ResourceKind = domain.ResourceKindSchema
	ctx := service.WithAuthzListFilter(t.Context(), filter)
	res, err := stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{
		Pagination: database.Page[domain.JSONSchemaField]{
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns: []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldURL)},
			},
		},
	}, service.JSONSchemaQueryOptions{})
	require.NoError(t, err)
	require.Len(t, res.Items, 1, "only the authorized schema is listed")
	assert.Equal(t, "https://example.com/schemas/machine.json", res.Items[0].URL)
}

// A document that does not parse fails the read. Silently skipping it would
// look to the operator like their file had been ignored or deleted.
func TestSchemaListRejectsAnUnparseableFile(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	dir := filepath.Join(store.Root(), schemasDir)
	require.NoError(t, os.MkdirAll(dir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "broken.json"), []byte("{not json"), 0o600))

	_, err := stmts.ListJSONSchemas(unrestricted(t), &database.ListOptions[domain.JSONSchemaField]{}, service.JSONSchemaQueryOptions{})
	require.Error(t, err)
	assert.Equal(t, domain.ErrJSONSchemaInvalid().Code, err.(domain.Error).Code)
}

// A missing tree is an empty configuration, not a failure: the server may start
// before `zitadel setup` writes anything.
func TestMissingTreeReadsEmpty(t *testing.T) {
	t.Parallel()

	stmts, _, _ := newStatements(t)
	res, err := stmts.ListJSONSchemas(unrestricted(t), &database.ListOptions[domain.JSONSchemaField]{}, service.JSONSchemaQueryOptions{})
	require.NoError(t, err)
	assert.Empty(t, res.Items)
}
