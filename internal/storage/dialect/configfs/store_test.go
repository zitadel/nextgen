package configfs

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// eventually retries until the watcher goroutine has applied a change. File
// events are delivered asynchronously, so a test that read once would be
// asserting on timing rather than behaviour.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// A store cannot serve a project it cannot name, so the document that names it
// is required rather than defaulted.
func TestStoreRequiresAProject(t *testing.T) {
	t.Parallel()

	_, err := NewStore(t.Context(), t.TempDir())
	require.Error(t, err, "a tree with no zitadel.json has no project")

	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "zitadel.json"), []byte(`{}`), 0o600))
	_, err = NewStore(t.Context(), root)
	require.Error(t, err, "an empty project is not a project")
}

// The index is optional: a hand-authored tree has none until the CLI syncs it.
func TestStoreReadsWithoutAnIndex(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, schemasDir, "human-user", schemaDoc("human-user", "H"))

	got, err := stmts.GetJSONSchemaByID(unrestricted(t), testProject,
		"https://example.com/schemas/human-user.json")
	require.NoError(t, err)
	assert.Equal(t, "human-user", *got.ObjectType,
		"a document is addressable by its own handle before the index knows it")
}

// TestIndexSuppliesResourceIDs is why the index is read at all: a resource that
// the CLI uploaded has a server-minted id, and things outside this tree — a
// release pointer, a user's schema reference, an RSI row — already point at it.
// Serving the file under its handle instead would make all of those dangle.
func TestIndexSuppliesResourceIDs(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	ctx := unrestricted(t)

	writeFile(t, store, schemasDir, "default-human-user", schemaDoc("human-user", "H"))
	writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))
	writeFile(t, store, brandingDir, cliBrandingFile, brandingDoc("https://example.com/a.png"))

	writeState(t, store, map[string]string{
		".zitadel/schemas/default-human-user.json": "sch_01MINTED",
		".zitadel/flows/default-login.json":        "flowdef_01MINTED",
		".zitadel/branding/branding.json":          "brnd_01MINTED",
	})

	schema, err := stmts.GetJSONSchemaByID(ctx, testProject, "sch_01MINTED")
	require.NoError(t, err)
	assert.Equal(t, "human-user", *schema.ObjectType)

	flow, err := stmts.GetFlowDefinitionByID(ctx, testProject, "flowdef_01MINTED")
	require.NoError(t, err)
	assert.Equal(t, "default-login", flow.Name, "the handle still names it")

	brand, err := stmts.GetBrandingByID(ctx, testProject, "brnd_01MINTED")
	require.NoError(t, err)
	assert.Equal(t, "centered", brand.Layout)
}

// An indexed resource is no longer addressable by its handle: the index decides
// the identity, and answering to both would give one resource two ids.
func TestIndexedResourceDropsItsHandle(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))
	writeState(t, store, map[string]string{
		".zitadel/flows/default-login.json": "flowdef_01MINTED",
	})

	_, err := stmts.GetFlowDefinitionByID(unrestricted(t), testProject, "default-login")
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

// TestWatcherFollowsTheProject is the reload half: zitadel.json is watched, so
// a project renamed while the server runs is picked up without a restart.
func TestWatcherFollowsTheProject(t *testing.T) {
	t.Parallel()

	_, store, _ := newStatements(t)
	require.Equal(t, testProject, store.ProjectID())

	require.NoError(t, os.WriteFile(filepath.Join(store.Root(), "zitadel.json"),
		[]byte(`{"project":"proj_renamed"}`), 0o600))

	eventually(t, "the project to be re-read", func() bool {
		return store.ProjectID() == "proj_renamed"
	})
}

// And the index half: an id recorded by `zitadel setup` mid-session is visible
// to the next read, which is the whole point of watching it.
func TestWatcherFollowsTheIndex(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))

	// The CLI records the id it got back from the server.
	require.NoError(t, os.MkdirAll(filepath.Join(store.Root(), zitadelDir), 0o700))
	require.NoError(t, os.WriteFile(store.stateFilePath(),
		[]byte(`{"resources":{".zitadel/flows/default-login.json":{"id":"flowdef_01LATE"}}}`), 0o600))

	eventually(t, "the index to be re-read", func() bool {
		id, ok := store.idFor(".zitadel/flows/default-login.json")
		return ok && id == "flowdef_01LATE"
	})

	got, err := stmts.GetFlowDefinitionByID(unrestricted(t), testProject, "flowdef_01LATE")
	require.NoError(t, err)
	assert.Equal(t, "default-login", got.Name)
}

// A watch on a file follows the inode, and every writer here replaces rather
// than truncates. Watching the directory is what keeps reload working past the
// first save; this pins that it survives a rename.
func TestWatcherSurvivesAReplacedFile(t *testing.T) {
	t.Parallel()

	_, store, _ := newStatements(t)
	final := filepath.Join(store.Root(), "zitadel.json")

	for _, project := range []string{"proj_second", "proj_third"} {
		staged := filepath.Join(store.Root(), "zitadel.json.tmp")
		require.NoError(t, os.WriteFile(staged, []byte(`{"project":"`+project+`"}`), 0o600))
		require.NoError(t, os.Rename(staged, final))

		eventually(t, "a replaced file to be re-read", func() bool {
			return store.ProjectID() == project
		})
	}
}

// A half-written document must not replace a good one. The next complete write
// wins, which is how an editor's truncate-then-write is ridden out.
func TestWatcherKeepsTheLastGoodValue(t *testing.T) {
	t.Parallel()

	_, store, _ := newStatements(t)

	require.NoError(t, os.WriteFile(filepath.Join(store.Root(), "zitadel.json"),
		[]byte(`{"project":`), 0o600))

	// Nothing to wait for: the assertion is that the value does not change.
	time.Sleep(200 * time.Millisecond)
	assert.Equal(t, testProject, store.ProjectID(), "a broken write keeps the previous project")

	require.NoError(t, os.WriteFile(filepath.Join(store.Root(), "zitadel.json"),
		[]byte(`{"project":"proj_recovered"}`), 0o600))
	eventually(t, "the completed write to be re-read", func() bool {
		return store.ProjectID() == "proj_recovered"
	})
}

// Reads happen on request goroutines while the watcher replaces the documents.
// Run with -race, this is what catches an unguarded field.
func TestStoreIsSafeUnderConcurrentReload(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, schemasDir, "human-user", schemaDoc("human-user", "H"))
	ctx := unrestricted(t)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 50; i++ {
			_ = os.WriteFile(filepath.Join(store.Root(), "zitadel.json"),
				[]byte(`{"project":"`+testProject+`"}`), 0o600)
		}
	}()

	for i := 0; i < 50; i++ {
		_, err := stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{},
			service.JSONSchemaQueryOptions{})
		require.NoError(t, err)
		_ = store.ProjectID()
	}
	<-done
}
