package configfs

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// flowDoc is the shape `zitadel setup` writes to .zitadel/flows/, trimmed to
// what the store reads.
func flowDoc(name, firstStep string) []byte {
	return []byte(`{
  "name": "` + name + `",
  "status": "active",
  "user_schema": "https://example.com/schemas/human-user.json",
  "purposes": {"login": "` + firstStep + `"},
  "steps": [
    {
      "name": "` + firstStep + `",
      "fields": ["email"],
      "actions": [{"name": "submit", "kind": "submit", "primary": true}]
    }
  ]
}`)
}

func brandingDoc(logo string) []byte {
	return []byte(`{"layout": "centered", "logo_url": "` + logo + `"}`)
}

func writeFile(t *testing.T, store *Store, kind, name string, content []byte) string {
	t.Helper()
	dir := filepath.Join(store.Root(), kind)
	require.NoError(t, os.MkdirAll(dir, 0o700))
	path := filepath.Join(dir, name+".json")
	require.NoError(t, os.WriteFile(path, content, 0o600))
	return path
}

func TestFlowDefinitionsReadThroughToDisk(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	ctx := unrestricted(t)
	path := writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))

	got, err := stmts.GetFlowDefinitionByID(ctx, testProject, "default-login")
	require.NoError(t, err)
	assert.Equal(t, "default-login", got.Name)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got.Status)
	assert.Equal(t, "https://example.com/schemas/human-user.json", got.UserSchema)
	require.Len(t, got.Steps, 1)
	assert.Equal(t, "identifier", got.Steps[0].Name)

	// The edit a developer makes while the server is running.
	require.NoError(t, os.WriteFile(path, flowDoc("default-login", "password"), 0o600))

	got, err = stmts.GetFlowDefinitionByID(ctx, testProject, "default-login")
	require.NoError(t, err)
	require.Len(t, got.Steps, 1)
	assert.Equal(t, "password", got.Steps[0].Name, "the next read must serve the edited flow")
}

func TestFlowDefinitionsListFromDisk(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))
	writeFile(t, store, flowsDir, "admin-login", flowDoc("admin-login", "identifier"))

	res, err := stmts.ListFlowDefinitions(unrestricted(t), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), testProject),
		Pagination: database.Page[domain.FlowDefinitionField]{
			OrderBy: database.OrderBy[domain.FlowDefinitionField]{
				Columns: []database.Column[domain.FlowDefinitionField]{database.Col(domain.FlowDefinitionFieldName)},
			},
		},
	}, service.FlowDefinitionQueryOptions{})
	require.NoError(t, err)
	require.Len(t, res.Items, 2)
	assert.Equal(t, "admin-login", res.Items[0].Name)
	assert.Equal(t, "default-login", res.Items[1].Name)
}

// A flow written through the API must be readable back as the same flow, so
// the CLI's upload and a hand edit of the file cannot disagree.
func TestFlowDefinitionRoundTripsThroughAFile(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	ctx := unrestricted(t)

	// Seed from a document so the fixture is the real authoring shape.
	writeFile(t, store, flowsDir, "seed", flowDoc("seed", "identifier"))
	original, err := stmts.GetFlowDefinitionByID(ctx, testProject, "seed")
	require.NoError(t, err)

	original.Name = "written"
	require.NoError(t, stmts.CreateFlowDefinition(ctx, original))

	// Addressed by its id, not its name: the two are independent now that the
	// document carries an explicit id, and renaming a flow does not re-identify
	// it.
	got, err := stmts.GetFlowDefinitionByID(ctx, testProject, original.ID)
	require.NoError(t, err)
	assert.Equal(t, original.UserSchema, got.UserSchema)
	assert.Equal(t, original.Purposes, got.Purposes)
	require.Len(t, got.Steps, len(original.Steps))
	assert.Equal(t, original.Steps[0].Name, got.Steps[0].Name)
	assert.Equal(t, original.Steps[0].Fields, got.Steps[0].Fields)

	// And what landed on disk is the document a person would edit, not an
	// internal envelope.
	onDisk, err := os.ReadFile(filepath.Join(store.Root(), flowsDir, "written.json"))
	require.NoError(t, err)
	assert.Contains(t, string(onDisk), `"name": "written"`)
	assert.Contains(t, string(onDisk), `"user_schema"`)
}

func TestFlowDefinitionDeleteRemovesTheFile(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	path := writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))

	require.NoError(t, stmts.DeleteFlowDefinitionByID(t.Context(), testProject, "default-login"))
	_, err := os.Stat(path)
	assert.True(t, os.IsNotExist(err), "the document is gone from the tree")
}

func TestFlowDefinitionListFailsClosedWithoutAnAuthzFilter(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, flowsDir, "default-login", flowDoc("default-login", "identifier"))

	_, err := stmts.ListFlowDefinitions(t.Context(), &database.ListOptions[domain.FlowDefinitionField]{Filter: database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), testProject)}, service.FlowDefinitionQueryOptions{})
	require.ErrorIs(t, err, service.ErrListFilterRequired)
}

func TestFlowDefinitionRejectsAnUnparseableFile(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, flowsDir, "broken", []byte("{not json"))

	_, err := stmts.ListFlowDefinitions(unrestricted(t), &database.ListOptions[domain.FlowDefinitionField]{Filter: database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), testProject)}, service.FlowDefinitionQueryOptions{})
	require.Error(t, err)
}

func TestBrandingReadsThroughToDisk(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	ctx := unrestricted(t)
	// The CLI's file name, which the store accepts as the project's branding.
	path := writeFile(t, store, brandingDir, cliBrandingFile, brandingDoc("https://example.com/a.png"))

	got, err := stmts.GetBrandingByID(ctx, testProject, brandingHandle)
	require.NoError(t, err)
	assert.Equal(t, "centered", got.Layout)
	assert.Equal(t, "https://example.com/a.png", got.LogoURL)

	require.NoError(t, os.WriteFile(path, brandingDoc("https://example.com/b.png"), 0o600))

	got, err = stmts.GetBrandingByID(ctx, testProject, brandingHandle)
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/b.png", got.LogoURL, "the next read must serve the edited branding")
}

// The liquid templates that sit beside the document are assets it points at,
// not branding resources, so they must not surface as revisions.
func TestBrandingIgnoresLayoutAssets(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, brandingDir, cliBrandingFile, brandingDoc("https://example.com/a.png"))
	writeFile(t, store, brandingDir, "some-layout-metadata", []byte(`{"not":"a branding"}`))

	res, err := stmts.ListBrandings(unrestricted(t), &database.ListOptions[domain.BrandingField]{Filter: database.Equal(database.Col(domain.BrandingFieldProjectID), testProject)})
	require.NoError(t, err)
	require.Len(t, res.Items, 1, "only the project's branding document is a resource")
	assert.Equal(t, brandingHandle, res.Items[0].ID)
}

func TestBrandingRoundTripsThroughAFile(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	ctx := unrestricted(t)

	require.NoError(t, stmts.CreateBranding(ctx, &domain.Branding{
		ProjectID: testProject,
		ID:        brandingHandle,
		Layout:    "split",
		LogoURL:   "https://example.com/logo.png",
		HeroURL:   "https://example.com/hero.png",
	}))

	got, err := stmts.GetBrandingByID(ctx, testProject, brandingHandle)
	require.NoError(t, err)
	assert.Equal(t, "split", got.Layout)
	assert.Equal(t, "https://example.com/hero.png", got.HeroURL)

	onDisk, err := os.ReadFile(filepath.Join(store.Root(), brandingDir, brandingHandle+".json"))
	require.NoError(t, err)
	assert.Contains(t, string(onDisk), `"layout": "split"`)
}

func TestBrandingListFailsClosedWithoutAnAuthzFilter(t *testing.T) {
	t.Parallel()

	stmts, store, _ := newStatements(t)
	writeFile(t, store, brandingDir, cliBrandingFile, brandingDoc("https://example.com/a.png"))

	_, err := stmts.ListBrandings(t.Context(), &database.ListOptions[domain.BrandingField]{Filter: database.Equal(database.Col(domain.BrandingFieldProjectID), testProject)})
	require.ErrorIs(t, err, service.ErrListFilterRequired)
}

// Everything that is not a configuration kind still goes to SQL. Declaring a
// method on Statements is the only thing that moves a call to the file tree,
// so a kind nobody declared must reach the embedded implementation untouched.
func TestNonConfigKindsStayOnSQL(t *testing.T) {
	t.Parallel()

	stmts, _, sql := newStatements(t)

	sql.EXPECT().
		GetProjectByID(gomock.Any(), "proj_configfs").
		Return(&domain.Project{ID: testProject}, nil)

	got, err := stmts.GetProjectByID(t.Context(), testProject)
	require.NoError(t, err)
	assert.Equal(t, testProject, got.ID)
}
