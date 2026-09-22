package configfs

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
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

// A tree that has not been set up yet still opens. `zitadel setup` needs a
// running server to upload to, and it is setup that writes zitadel.json — a
// store that demanded a project up front could never be pointed at a directory
// setup had not already produced.
func TestStoreOpensBeforeSetup(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	store, err := NewStore(t.Context(), root)
	require.NoError(t, err, "an empty directory is a project that has not been set up yet")
	t.Cleanup(func() { _ = store.Close() })

	assert.Empty(t, store.ProjectID())
	assert.False(t, store.serves("proj_anything"),
		"an unnamed tree serves nothing, rather than serving everyone")

	// Setup runs, and the server adopts the project without a restart.
	require.NoError(t, os.WriteFile(filepath.Join(root, "zitadel.json"),
		[]byte(`{"project":"proj_after_setup"}`), 0o600))

	eventually(t, "the project to be adopted", func() bool {
		return store.ProjectID() == "proj_after_setup"
	})
	assert.True(t, store.serves("proj_after_setup"))
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

// Reads happen on request goroutines while the watcher replaces the documents,
// and now the initial snapshot can run concurrently with an event-driven
// reload too. Run with -race, this is what catches an unguarded field or a
// read moved back outside the lock.
func TestStoreIsSafeUnderConcurrentReload(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, schemasDir, "human-user", schemaDoc("human-user", "H"))
	writeState(t, store, map[string]string{
		".zitadel/schemas/human-user.json": "sch_01MINTED",
	})
	ctx := unrestricted(t)

	var wg sync.WaitGroup

	// Writers, so the watcher has real events to react to.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			_ = os.WriteFile(filepath.Join(store.Root(), "zitadel.json"),
				[]byte(`{"project":"`+testProject+`"}`), 0o600)
		}
	}()

	// Reloads racing each other, which is the shape NewStore now creates
	// between its snapshot and the watcher it already started.
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 30; i++ {
				_ = store.reloadZitadelJSON()
				_ = store.reloadStateFile()
			}
		}()
	}

	// Readers.
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 30; i++ {
				_ = store.ProjectID()
				_, _ = store.idFor(".zitadel/schemas/human-user.json")
				_, _ = stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), testProject)},
					service.JSONSchemaQueryOptions{})
			}
		}()
	}

	wg.Wait()
	assert.Equal(t, testProject, store.ProjectID())
}

// A malformed document does not stop the server either, and is adopted once
// corrected. A server that refused to boot because a config file was mid-write
// would be a worse failure than serving no configuration for a moment.
func TestStoreOpensWithABrokenProjectFile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "zitadel.json"), []byte(`{"project":`), 0o600))

	store, err := NewStore(t.Context(), root)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	assert.Empty(t, store.ProjectID(), "an unparseable document names no project")

	require.NoError(t, os.WriteFile(filepath.Join(root, "zitadel.json"),
		[]byte(`{"project":"proj_fixed"}`), 0o600))
	eventually(t, "the corrected document to be adopted", func() bool {
		return store.ProjectID() == "proj_fixed"
	})
}

// A document edited on disk must tell the server to drop what it derived from
// the previous content. Without this the schema read reflects the edit while a
// compiled copy of the same schema, cached under an id that did not change,
// does not — which surfaces as a flow failing to find a field the file plainly
// declares.
func TestResourceEditsNotifyListeners(t *testing.T) {
	t.Parallel()

	_, store, _ := newStatements(t)

	var notified atomic.Int64
	store.OnConfigChange(func() { notified.Add(1) })

	writeFile(t, store, schemasDir, "human-user", schemaDoc("human-user", "First"))
	eventually(t, "a new document to notify", func() bool { return notified.Load() > 0 })

	before := notified.Load()
	writeFile(t, store, schemasDir, "human-user", schemaDoc("human-user", "Second"))
	eventually(t, "an edited document to notify", func() bool { return notified.Load() > before })

	// Flows and branding too, not just schemas.
	beforeFlow := notified.Load()
	writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))
	eventually(t, "a flow document to notify", func() bool { return notified.Load() > beforeFlow })

	beforeBranding := notified.Load()
	writeFile(t, store, brandingDir, cliBrandingFile, brandingDoc("https://example.com/a.png"))
	eventually(t, "a branding document to notify", func() bool { return notified.Load() > beforeBranding })
}

// The two files describing the tree are not resource documents; reloading them
// is already handled and must not be mistaken for a content change.
func TestDescribingFilesDoNotNotify(t *testing.T) {
	t.Parallel()

	_, store, _ := newStatements(t)
	var notified atomic.Int64
	store.OnConfigChange(func() { notified.Add(1) })

	require.NoError(t, os.WriteFile(filepath.Join(store.Root(), "zitadel.json"),
		[]byte(`{"project":"proj_renamed"}`), 0o600))
	eventually(t, "the project to be re-read", func() bool { return store.ProjectID() == "proj_renamed" })

	assert.Zero(t, notified.Load(), "zitadel.json is not a resource document")
}
