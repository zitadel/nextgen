//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"cmp"
	"slices"
	"sync"
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

// idpRevisionIDsOldestFirst sorts snapshots of one connection by the key the
// history list pages on — the revision's creation time, which every read serves
// as UpdatedAt, then the revision id — ascending, so an expectation holds even
// when two revises land on the same timestamp.
func idpRevisionIDsOldestFirst(revisions []domain.IDPConnection) []string {
	sorted := slices.SortedFunc(slices.Values(revisions), func(a, b domain.IDPConnection) int {
		return cmp.Or(a.UpdatedAt.Compare(b.UpdatedAt), cmp.Compare(a.RevisionID, b.RevisionID))
	})
	ids := make([]string, 0, len(sorted))
	for _, revision := range sorted {
		ids = append(ids, revision.RevisionID)
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
		// UpdatedAt is the creation time of the revision a read serves, and the
		// first revision is written in the same transaction as the connection.
		// Postgres and SQLite stamp both rows from one clock reading; Spanner
		// evaluates CURRENT_TIMESTAMP() per statement, so the portable claim is
		// that a connection which was never revised does not look edited, not
		// that the two stamps are bit-identical.
		assert.False(t, entity.UpdatedAt.Before(entity.CreatedAt), "the first revision cannot predate the connection")
		assert.WithinDuration(t, entity.CreatedAt, entity.UpdatedAt, time.Second)

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

		// The connection carries no updated_at of its own, so both reads serve
		// the same revision row's created_at and cannot drift apart.
		assert.True(t, byID.UpdatedAt.Equal(revision.UpdatedAt), "the head and the pinned read must report the same revision timestamp")
		assert.True(t, byID.UpdatedAt.Equal(entity.UpdatedAt), "create must report the timestamp a read serves")
	})
}

// The slug is what schemas and flow definitions reference a connection by, so a
// second connection cannot take it. Storage reports the collision as a
// *database.UniqueError and leaves the service to decide that creating over an
// existing slug is the revise path.
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
		assert.True(t, pinned.CreatedAt.Equal(byID.CreatedAt), "a revision repeats the connection's birth rather than its own")

		// The head's updated_at is the new revision's creation time, to the
		// instant: it is read off the same row either way.
		head, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, entity.RevisionID)
		require.NoError(t, err)
		assert.True(t, byID.UpdatedAt.Equal(head.UpdatedAt), "the head read must report the revision it serves")
		assert.False(t, byID.UpdatedAt.Before(pinned.UpdatedAt), "an appended revision cannot predate the one it supersedes")
	})
}

// The history read pages revision rows rather than heads: each row repeats the
// connection's identity and carries the document, revision id and creation time
// of the revision it stands for, newest first.
func TestIDPConnectionStatements_ListRevisionsNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		slug := "history-" + uniqueSuffix(t)
		documents := [][]byte{
			idpConnectionDocument("https://v1.example.com"),
			idpConnectionDocument("https://v2.example.com"),
			idpConnectionDocument("https://v3.example.com"),
		}

		entity := createIDPConnection(t, d.stmts, projectID, slug, documents[0])
		written := []domain.IDPConnection{*entity}
		byRevisionID := map[string][]byte{entity.RevisionID: documents[0]}
		for _, document := range documents[1:] {
			entity.Document = document
			require.NoError(t, d.stmts.ReviseIDPConnection(t.Context(), entity))
			written = append(written, *entity)
			byRevisionID[entity.RevisionID] = document
		}

		want := idpRevisionIDsOldestFirst(written)
		slices.Reverse(want)

		result, err := d.stmts.ListIDPConnectionRevisions(unfilteredListCtx(t), projectID, entity.ID, database.Page[domain.IDPConnectionField]{})
		require.NoError(t, err)

		got := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			got = append(got, item.RevisionID)
			// Identity comes from the connection, so every row repeats it; only
			// the document, the revision id and updated_at vary down the page.
			assert.Equal(t, entity.ID, item.ID)
			assert.Equal(t, slug, item.Slug)
			assert.True(t, item.CreatedAt.Equal(entity.CreatedAt), "every revision repeats the connection's birth")
			assert.JSONEq(t, string(byRevisionID[item.RevisionID]), string(item.Document), "revision %q", item.RevisionID)
		}
		assert.Equal(t, want, got)

		// The pinned read of the same revision serves the same row, so the two
		// endpoints agree on updated_at by construction.
		pinned, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, written[0].RevisionID)
		require.NoError(t, err)
		oldest := result.Items[len(result.Items)-1]
		assert.Equal(t, pinned.RevisionID, oldest.RevisionID)
		assert.True(t, pinned.UpdatedAt.Equal(oldest.UpdatedAt))

		// A connection nobody can name is an empty page rather than an error:
		// the handler pairs this with a get to tell an empty history from a
		// connection that is not there.
		missing, err := d.stmts.ListIDPConnectionRevisions(unfilteredListCtx(t), projectID, "idp_does_not_exist", database.Page[domain.IDPConnectionField]{})
		require.NoError(t, err)
		assert.Empty(t, missing.Items)

		// The project scopes the read, so another project's connection id
		// reaches nothing either.
		crossProject, err := d.stmts.ListIDPConnectionRevisions(unfilteredListCtx(t), otherProject, entity.ID, database.Page[domain.IDPConnectionField]{})
		require.NoError(t, err)
		assert.Empty(t, crossProject.Items)
	})
}

// Two revisions racing on the same connection are last-write-wins on the head:
// both revision rows survive and stay readable by id, and the head settles on
// whichever transaction committed last.
func TestIDPConnectionStatements_ConcurrentReviseLastWriteWins(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		v1Document := idpConnectionDocument("https://v1.example.com")
		documents := [2][]byte{
			idpConnectionDocument("https://v2.example.com"),
			idpConnectionDocument("https://v3.example.com"),
		}

		entity := createIDPConnection(t, d.stmts, projectID, "race-"+uniqueSuffix(t), v1Document)
		firstRevisionID := entity.RevisionID

		// Each writer revises its own copy of the entity: the statement writes
		// RevisionID, CreatedAt and UpdatedAt back onto the entity from inside
		// the transaction callback, and Spanner replays that callback on an
		// ABORTED retry, so a shared struct would be a data race rather than a
		// test of the storage layer.
		var (
			wg       sync.WaitGroup
			entities [2]domain.IDPConnection
			errs     [2]error
		)
		for i := range entities {
			entities[i] = *entity
			entities[i].Document = documents[i]
			wg.Go(func() {
				errs[i] = d.stmts.ReviseIDPConnection(t.Context(), &entities[i])
			})
		}
		wg.Wait()

		for i := range entities {
			// A dialect that surfaces a retryable busy or serialization error
			// here rather than handling it internally breaks the last-write-wins
			// contract for its callers.
			require.NoError(t, errs[i], "writer %d", i)
		}
		assert.NotEqual(t, entities[0].RevisionID, entities[1].RevisionID, "each revise mints its own revision id")
		assert.NotEqual(t, firstRevisionID, entities[0].RevisionID)
		assert.NotEqual(t, firstRevisionID, entities[1].RevisionID)

		// All three revisions stay readable and keep their own document, which
		// is what lets an in-flight auth attempt hold a pin through a race.
		for revisionID, want := range map[string][]byte{
			firstRevisionID:        v1Document,
			entities[0].RevisionID: documents[0],
			entities[1].RevisionID: documents[1],
		} {
			pinned, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, revisionID)
			require.NoError(t, err, "revision %q", revisionID)
			assert.Equal(t, entity.ID, pinned.ID)
			assert.JSONEq(t, string(want), string(pinned.Document), "revision %q", revisionID)
		}

		byID, err := d.stmts.GetIDPConnectionByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		// Which writer wins is commit order, so the head only has to name one of
		// the two and serve that one's document.
		winner := slices.IndexFunc(entities[:], func(e domain.IDPConnection) bool { return e.RevisionID == byID.RevisionID })
		require.NotEqual(t, -1, winner, "head %q is neither concurrent revision", byID.RevisionID)
		assert.JSONEq(t, string(documents[winner]), string(byID.Document))
		assert.False(t, byID.UpdatedAt.Before(byID.CreatedAt), "revising must not move updated_at behind created_at")
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
