//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"cmp"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// idpConnectionDocument is a configuration document shaped like the API
// contract's, but storage never looks inside it: only that the bytes come back
// as the same JSON object.
func idpConnectionDocument(issuer string) []byte {
	return []byte(`{"protocol":"oidc","issuer":"` + issuer + `","subject_claim":"sub"}`)
}

func createIDPConnection(t *testing.T, stmts service.AllStatements, projectID, slug string, document []byte) *domain.IDPConnection {
	t.Helper()
	entity := &domain.IDPConnection{ProjectID: projectID, Slug: slug, Document: document}
	require.NoError(t, stmts.CreateIDPConnection(t.Context(), entity))
	return entity
}

func idpConnectionListOptions(projectID string) *database.ListOptions[domain.IDPConnectionField] {
	return &database.ListOptions[domain.IDPConnectionField]{
		Filter: database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
	}
}

// idpConnectionIDsInDefaultOrder sorts fixtures by the key the default list
// order pages on — created_at, then id — so an expectation holds even when two
// connections land on the same timestamp.
func idpConnectionIDsInDefaultOrder(connections []*domain.IDPConnection) []string {
	sorted := slices.SortedFunc(slices.Values(connections), func(a, b *domain.IDPConnection) int {
		return cmp.Or(a.CreatedAt.Compare(b.CreatedAt), cmp.Compare(a.ID, b.ID))
	})
	ids := make([]string, 0, len(sorted))
	for _, entity := range sorted {
		ids = append(ids, entity.ID)
	}
	return ids
}

func TestIDPConnectionStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "google-" + uniqueSuffix(t)
		document := idpConnectionDocument("https://accounts.google.com")

		entity := createIDPConnection(t, d.stmts, projectID, slug, document)

		// Both ids are minted by the dialect, not the caller (ADR 047), and a
		// revision carries its own prefix rather than the connection's.
		assert.True(t, domain.PrefixIDPConnection.Matches(entity.ID), "id %q is not idp_-prefixed", entity.ID)
		assert.True(t, domain.PrefixIDPConnectionRevision.Matches(entity.RevisionID), "revision id %q is not idprev_-prefixed", entity.RevisionID)
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
		assert.True(t, entity.CreatedAt.Equal(entity.UpdatedAt), "a connection that was never revised must not look edited")

		// The resource-scope index row is what the HTTP management gate reads
		// to resolve the connection's project, so create writes it in the same
		// transaction as the rows themselves.
		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindIDPConnection, projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindIDPConnection, scope.ResourceKind)
		assert.Equal(t, projectID, scope.ProjectID)
		assert.Nil(t, scope.TeamID)

		byID, err := d.stmts.GetIDPConnectionByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, slug, byID.Slug)
		assert.Equal(t, entity.RevisionID, byID.RevisionID)
		// The document round-trips through three JSON representations — JSONB,
		// Spanner JSON and a TEXT column — and only Spanner's re-serializes, so
		// the assertion is on the JSON rather than on the bytes.
		assert.JSONEq(t, string(document), string(byID.Document))

		bySlug, err := d.stmts.GetIDPConnectionBySlug(t.Context(), projectID, slug)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, bySlug.ID)
		assert.Equal(t, entity.RevisionID, bySlug.RevisionID)

		// The pinned read serves the same revision the head names, since there
		// is only one so far.
		revision, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, entity.RevisionID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, revision.ID)
		assert.Equal(t, entity.RevisionID, revision.RevisionID)
		assert.JSONEq(t, string(document), string(revision.Document))
	})
}

// The slug is what schemas and flow definitions reference a connection by, so a
// second connection cannot take it. The typed error is what the service maps to
// idp.already_exists.
func TestIDPConnectionStatements_SlugUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "okta-" + uniqueSuffix(t)
		createIDPConnection(t, d.stmts, projectID, slug, idpConnectionDocument("https://one.example.com"))

		dup := &domain.IDPConnection{ProjectID: projectID, Slug: slug, Document: idpConnectionDocument("https://two.example.com")}
		err := d.stmts.CreateIDPConnection(t.Context(), dup)
		assert.ErrorIs(t, err, new(database.UniqueError))
	})
}

// Two projects legitimately name their connections the same, so the slug is
// unique per project rather than globally.
func TestIDPConnectionStatements_SlugReusableAcrossProjects(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectA := ensureProject(t, d.stmts)
		projectB := ensureProject(t, d.stmts)
		slug := "shared-" + uniqueSuffix(t)

		connA := createIDPConnection(t, d.stmts, projectA, slug, idpConnectionDocument("https://a.example.com"))
		connB := createIDPConnection(t, d.stmts, projectB, slug, idpConnectionDocument("https://b.example.com"))
		assert.NotEqual(t, connA.ID, connB.ID)

		// A read scoped to project A cannot reach project B's connection even
		// though the slugs match.
		got, err := d.stmts.GetIDPConnectionBySlug(t.Context(), projectA, slug)
		require.NoError(t, err)
		assert.Equal(t, connA.ID, got.ID)

		_, err = d.stmts.GetIDPConnectionByID(t.Context(), projectA, connB.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// Revising appends: the head moves to the new revision while the old one stays
// readable and unchanged, which is what lets an in-flight auth attempt pin a
// revision and keep reading the configuration it started with.
func TestIDPConnectionStatements_ReviseAppendsAndMovesHead(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "entra-" + uniqueSuffix(t)
		v1Document := idpConnectionDocument("https://v1.example.com")
		v2Document := idpConnectionDocument("https://v2.example.com")

		entity := createIDPConnection(t, d.stmts, projectID, slug, v1Document)
		firstRevisionID := entity.RevisionID

		entity.Document = v2Document
		require.NoError(t, d.stmts.ReviseIDPConnection(t.Context(), entity))
		assert.NotEqual(t, firstRevisionID, entity.RevisionID)
		assert.True(t, domain.PrefixIDPConnectionRevision.Matches(entity.RevisionID))
		assert.False(t, entity.UpdatedAt.Before(entity.CreatedAt), "revising must not move updated_at behind created_at")

		byID, err := d.stmts.GetIDPConnectionByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, entity.RevisionID, byID.RevisionID)
		assert.JSONEq(t, string(v2Document), string(byID.Document))

		bySlug, err := d.stmts.GetIDPConnectionBySlug(t.Context(), projectID, slug)
		require.NoError(t, err)
		assert.Equal(t, entity.RevisionID, bySlug.RevisionID)
		assert.JSONEq(t, string(v2Document), string(bySlug.Document))

		pinned, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, firstRevisionID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, pinned.ID)
		assert.Equal(t, firstRevisionID, pinned.RevisionID)
		assert.JSONEq(t, string(v1Document), string(pinned.Document), "an appended revision must not rewrite the one before it")
		assert.Equal(t, slug, pinned.Slug)
	})
}

// Revising a connection that is not there must fail before the revision row is
// written, rather than leaving a revision no head points at.
func TestIDPConnectionStatements_ReviseUnknownIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)

		err := d.stmts.ReviseIDPConnection(t.Context(), &domain.IDPConnection{
			ProjectID: projectID,
			ID:        "idp_does_not_exist",
			Document:  idpConnectionDocument("https://nowhere.example.com"),
		})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestIDPConnectionStatements_GetMissesAreNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		slug := "miss-" + uniqueSuffix(t)
		entity := createIDPConnection(t, d.stmts, projectID, slug, idpConnectionDocument("https://miss.example.com"))

		_, err := d.stmts.GetIDPConnectionByID(t.Context(), projectID, "idp_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnectionBySlug(t.Context(), projectID, slug+"-nope")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnectionByID(t.Context(), otherProject, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnectionBySlug(t.Context(), otherProject, slug)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnectionRevision(t.Context(), otherProject, entity.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnectionRevision(t.Context(), projectID, "idprev_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestIDPConnectionStatements_ListIsProjectScopedOldestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		created := make([]*domain.IDPConnection, 0, 3)
		for _, name := range []string{"a", "b", "c"} {
			created = append(created, createIDPConnection(t, d.stmts, projectID, name+"-"+suffix, idpConnectionDocument("https://"+name+".example.com")))
		}
		createIDPConnection(t, d.stmts, otherProject, "other-"+suffix, idpConnectionDocument("https://other.example.com"))

		// Sorted by the key the default order uses rather than by insertion:
		// two connections can land on the same created_at, and the id that
		// breaks that tie is a UUID on Spanner, unrelated to insertion order.
		want := idpConnectionIDsInDefaultOrder(created)

		result, err := d.stmts.ListIDPConnections(unfilteredListCtx(t), idpConnectionListOptions(projectID))
		require.NoError(t, err)

		got := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			assert.Equal(t, projectID, item.ProjectID)
			got = append(got, item.ID)
		}
		// EnsureListOptions defaults to created_at + id ascending, so oldest
		// first — the divergence from flow definitions and releases, which
		// default to newest first.
		assert.Equal(t, want, got)
	})
}

// A list row carries the document of the revision the head names, not the one
// the connection was created with.
func TestIDPConnectionStatements_ListServesLatestDocument(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		latest := idpConnectionDocument("https://latest.example.com")

		entity := createIDPConnection(t, d.stmts, projectID, "latest-"+uniqueSuffix(t), idpConnectionDocument("https://stale.example.com"))
		entity.Document = latest
		require.NoError(t, d.stmts.ReviseIDPConnection(t.Context(), entity))

		result, err := d.stmts.ListIDPConnections(unfilteredListCtx(t), idpConnectionListOptions(projectID))
		require.NoError(t, err)
		require.Len(t, result.Items, 1)
		assert.Equal(t, entity.RevisionID, result.Items[0].RevisionID)
		assert.JSONEq(t, string(latest), string(result.Items[0].Document))
	})
}

// The project FK cascades through the connection to its revisions, so deleting
// a project leaves no revisions of a connection that no longer exists.
func TestIDPConnectionStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		entity := createIDPConnection(t, d.stmts, projectID, "cascade-"+uniqueSuffix(t), idpConnectionDocument("https://cascade.example.com"))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		result, err := d.stmts.ListIDPConnections(unfilteredListCtx(t), idpConnectionListOptions(projectID))
		require.NoError(t, err)
		assert.Empty(t, result.Items)

		_, err = d.stmts.GetIDPConnectionRevision(t.Context(), projectID, entity.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
