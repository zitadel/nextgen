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

// idpConnectionDocument is shaped like the API contract's document, but storage
// never looks inside it.
func idpConnectionDocument(issuer string) []byte {
	return []byte(`{"protocol":"oidc","issuer":"` + issuer + `","subject_claim":"sub"}`)
}

func createIDPConnection(t *testing.T, stmts service.AllStatements, projectID, slug string, document []byte) *domain.IDPConnection {
	t.Helper()
	entity := &domain.IDPConnection{ProjectID: projectID, Slug: slug, Document: document}
	require.NoError(t, stmts.CreateIDPConnection(t.Context(), entity))
	return entity
}

func idpConnectionByID(projectID, id string) database.Filter[domain.IDPConnectionField] {
	return database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldID), id),
	)
}

func idpConnectionBySlug(projectID, slug string) database.Filter[domain.IDPConnectionField] {
	return database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldSlug), slug),
	)
}

func idpConnectionListOptions(projectID string) *database.ListOptions[domain.IDPConnectionField] {
	return &database.ListOptions[domain.IDPConnectionField]{
		Filter: database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
	}
}

// idpConnectionIDsInDefaultOrder sorts fixtures by the default list key,
// created_at then id, so an expectation holds when two connections share a
// timestamp.
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

// idpRevisionIDsOldestFirst sorts copies of one connection by the history list
// key, UpdatedAt then the revision id, ascending.
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

		// The dialect generates both ids, not the caller (ADR 047), and each
		// carries its own prefix.
		assert.True(t, domain.PrefixIDPConnection.Matches(entity.ID), "id %q is not idp_-prefixed", entity.ID)
		assert.True(t, domain.PrefixIDPConnectionRevision.Matches(entity.RevisionID), "revision id %q is not idprev_-prefixed", entity.RevisionID)
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
		assert.True(t, entity.CreatedAt.Equal(entity.UpdatedAt), "a connection that was never revised must not look edited")

		// The HTTP management gate reads this row to resolve the connection's
		// project, so create writes it in the same transaction.
		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindIDPConnection, projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindIDPConnection, scope.ResourceKind)
		assert.Equal(t, projectID, scope.ProjectID)
		assert.Nil(t, scope.TeamID)

		byID, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(projectID, entity.ID))
		require.NoError(t, err)
		assert.Equal(t, slug, byID.Slug)
		assert.Equal(t, entity.RevisionID, byID.RevisionID)
		// Spanner re-serializes the document, so the assertion compares JSON
		// rather than bytes.
		assert.JSONEq(t, string(document), string(byID.Document))

		bySlug, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionBySlug(projectID, slug))
		require.NoError(t, err)
		assert.Equal(t, entity.ID, bySlug.ID)
		assert.Equal(t, entity.RevisionID, bySlug.RevisionID)

		revision, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, entity.RevisionID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, revision.ID)
		assert.Equal(t, entity.RevisionID, revision.RevisionID)
		assert.JSONEq(t, string(document), string(revision.Document))

		assert.True(t, byID.UpdatedAt.Equal(revision.UpdatedAt), "the get and the pinned read must report the same revision timestamp")
		assert.True(t, byID.UpdatedAt.Equal(entity.UpdatedAt), "create must report the timestamp a read serves")
		assert.True(t, byID.CreatedAt.Equal(byID.UpdatedAt), "a connection that was never revised must not read as edited")
	})
}

// Schemas and flow definitions reference a connection by slug, so a second
// connection cannot take it. Storage reports the collision as a
// *database.UniqueError and leaves the service to decide what to do.
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

// Two projects may use the same slug, so it is unique per project rather than
// globally.
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
		got, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionBySlug(projectA, slug))
		require.NoError(t, err)
		assert.Equal(t, connA.ID, got.ID)

		_, err = d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(projectA, connB.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// Revising appends: the reads move to the new revision, which carries the
// greater created_at, while the old one stays readable and unchanged.
func TestIDPConnectionStatements_ReviseAppendsRevision(t *testing.T) {
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

		byID, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(projectID, entity.ID))
		require.NoError(t, err)
		assert.Equal(t, entity.RevisionID, byID.RevisionID)
		assert.JSONEq(t, string(v2Document), string(byID.Document))

		bySlug, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionBySlug(projectID, slug))
		require.NoError(t, err)
		assert.Equal(t, entity.RevisionID, bySlug.RevisionID)
		assert.JSONEq(t, string(v2Document), string(bySlug.Document))

		pinned, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, firstRevisionID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, pinned.ID)
		assert.Equal(t, firstRevisionID, pinned.RevisionID)
		assert.JSONEq(t, string(v1Document), string(pinned.Document), "an appended revision must not rewrite the one before it")
		assert.Equal(t, slug, pinned.Slug)
		assert.True(t, pinned.CreatedAt.Equal(byID.CreatedAt), "a revision reports the connection's created_at, not its own")

		newest, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, entity.RevisionID)
		require.NoError(t, err)
		assert.True(t, byID.UpdatedAt.Equal(newest.UpdatedAt), "the get must report the revision it serves")
		assert.True(t, byID.UpdatedAt.After(pinned.UpdatedAt), "the newest revision is the one with the greater created_at")
	})
}

// The history read pages every revision rather than only the newest, newest
// first.
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
			// Identity comes from the connection, so only the document, the
			// revision id and updated_at vary down the page.
			assert.Equal(t, entity.ID, item.ID)
			assert.Equal(t, slug, item.Slug)
			assert.True(t, item.CreatedAt.Equal(entity.CreatedAt), "every revision reports the connection's created_at")
			assert.JSONEq(t, string(byRevisionID[item.RevisionID]), string(item.Document), "revision %q", item.RevisionID)
		}
		assert.Equal(t, want, got)

		pinned, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, written[0].RevisionID)
		require.NoError(t, err)
		oldest := result.Items[len(result.Items)-1]
		assert.Equal(t, pinned.RevisionID, oldest.RevisionID)
		assert.True(t, pinned.UpdatedAt.Equal(oldest.UpdatedAt))

		// An unknown connection is an empty page rather than an error, so the
		// handler needs a get to tell it from a connection with no revisions.
		missing, err := d.stmts.ListIDPConnectionRevisions(unfilteredListCtx(t), projectID, "idp_does_not_exist", database.Page[domain.IDPConnectionField]{})
		require.NoError(t, err)
		assert.Empty(t, missing.Items)

		// The project scopes the read, so another project reaches nothing.
		crossProject, err := d.stmts.ListIDPConnectionRevisions(unfilteredListCtx(t), otherProject, entity.ID, database.Page[domain.IDPConnectionField]{})
		require.NoError(t, err)
		assert.Empty(t, crossProject.Items)
	})
}

// Two revises racing on one connection each append a row, and the newest is
// the one with the greater created_at (ADR 063 §7). Two rows on the same
// instant would leave no newest, so the unique index rules that out and the
// loser gets a *database.UniqueError.
func TestIDPConnectionStatements_ConcurrentReviseAgreesOnNewest(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		v1Document := idpConnectionDocument("https://v1.example.com")
		documents := [2][]byte{
			idpConnectionDocument("https://v2.example.com"),
			idpConnectionDocument("https://v3.example.com"),
		}

		entity := createIDPConnection(t, d.stmts, projectID, "race-"+uniqueSuffix(t), v1Document)
		firstRevisionID := entity.RevisionID

		// Each writer revises its own copy: the statement writes RevisionID and
		// UpdatedAt back onto the entity, so a shared struct would be a data
		// race in the test rather than in storage.
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

		// The first revision plus every writer that got a row in.
		landed := map[string][]byte{firstRevisionID: v1Document}
		for i := range entities {
			if errs[i] != nil {
				// The same-instant tie is the only allowed failure: a retryable
				// busy or serialization error is the dialect's to handle.
				assert.ErrorIs(t, errs[i], new(database.UniqueError), "writer %d", i)
				continue
			}
			landed[entities[i].RevisionID] = documents[i]
		}
		require.Greater(t, len(landed), 1, "both writers lost the tie; at least one revise has to land")

		// Every revision that landed stays readable with its own document, so a
		// pin survives the race.
		for revisionID, want := range landed {
			pinned, err := d.stmts.GetIDPConnectionRevision(t.Context(), projectID, revisionID)
			require.NoError(t, err, "revision %q", revisionID)
			assert.Equal(t, entity.ID, pinned.ID)
			assert.JSONEq(t, string(want), string(pinned.Document), "revision %q", revisionID)
		}

		byID, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(projectID, entity.ID))
		require.NoError(t, err)
		assert.Contains(t, landed, byID.RevisionID, "the get serves a revision nobody wrote")
		assert.NotEqual(t, firstRevisionID, byID.RevisionID, "a revise that landed supersedes the first revision")
		assert.JSONEq(t, string(landed[byID.RevisionID]), string(byID.Document))
		assert.False(t, byID.UpdatedAt.Before(byID.CreatedAt), "revising must not move updated_at behind created_at")

		// The get and the history must agree on which revision is newest.
		history, err := d.stmts.ListIDPConnectionRevisions(unfilteredListCtx(t), projectID, entity.ID, database.Page[domain.IDPConnectionField]{})
		require.NoError(t, err)
		require.Len(t, history.Items, len(landed), "the history pages exactly the revisions that landed")
		assert.Equal(t, byID.RevisionID, history.Items[0].RevisionID, "the newest-first page must open on what the get serves")
		assert.True(t, byID.UpdatedAt.Equal(history.Items[0].UpdatedAt))
		assert.JSONEq(t, string(byID.Document), string(history.Items[0].Document))
	})
}

// Create writes three rows in one transaction, so a failure must leave nothing
// behind: a retry would otherwise hit the slug of a connection that was never
// created.
func TestIDPConnectionStatements_FailedCreateLeavesNothing(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "rollback-" + uniqueSuffix(t)

		// Valid JSON of the wrong shape: the connection insert succeeds and the
		// revision's document CHECK rejects the array, in every dialect.
		entity := &domain.IDPConnection{ProjectID: projectID, Slug: slug, Document: []byte(`[]`)}
		require.Error(t, d.stmts.CreateIDPConnection(t.Context(), entity))
		// The ids are generated before the write, so they name the rows to look
		// for.
		require.NotEmpty(t, entity.ID)
		require.NotEmpty(t, entity.RevisionID)

		_, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(projectID, entity.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnection(t.Context(), idpConnectionBySlug(projectID, slug))
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "the slug must be free for the retry")

		_, err = d.stmts.GetIDPConnectionRevision(t.Context(), projectID, entity.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindIDPConnection, projectID, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "the management gate must not resolve a connection that was rolled back")
	})
}

// Revising a connection that is not there must fail rather than leave a
// revision without a connection. The foreign key catches it and storage reports
// a not-found.
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

		_, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(projectID, "idp_does_not_exist"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnection(t.Context(), idpConnectionBySlug(projectID, slug+"-nope"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(otherProject, entity.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnection(t.Context(), idpConnectionBySlug(otherProject, slug))
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

		// Sorted by the default key rather than by insertion: two connections
		// can share a created_at, and the id that breaks the tie is a UUID on
		// Spanner.
		want := idpConnectionIDsInDefaultOrder(created)

		result, err := d.stmts.ListIDPConnections(unfilteredListCtx(t), idpConnectionListOptions(projectID))
		require.NoError(t, err)

		got := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			assert.Equal(t, projectID, item.ProjectID)
			got = append(got, item.ID)
		}
		// The default order is created_at + id ascending, unlike flow
		// definitions and releases, which default to newest first.
		assert.Equal(t, want, got)
	})
}

// A list row carries the document of the newest revision, not the one the
// connection was created with.
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

// A caller can narrow a list by slug and by creation time. Both columns belong
// to the connection, not the revision, so filtering on them catches a schema
// binding that points at the wrong table or a time value a dialect fails to
// coerce.
func TestIDPConnectionStatements_ListFiltersBySlugAndCreatedAt(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		latest := idpConnectionDocument("https://v3.example.com")

		// Gaps between the writes give the three fixtures distinct created_at
		// values, so a strict time bound has a subset to select.
		created := make([]*domain.IDPConnection, 0, 3)
		for _, name := range []string{"a", "b", "c"} {
			if len(created) > 0 {
				time.Sleep(2 * time.Millisecond)
			}
			created = append(created, createIDPConnection(t, d.stmts, projectID, "filter-"+name+"-"+suffix, idpConnectionDocument("https://v1.example.com")))
		}
		// The newest and then the oldest connection are revised twice each, so
		// the oldest one carries the most recent revision of the set. A filter
		// must still select the newest revision, and its time bound must
		// compare against the connection's created_at, not the revision's.
		for _, entity := range []*domain.IDPConnection{created[2], created[0]} {
			for _, document := range [][]byte{idpConnectionDocument("https://v2.example.com"), latest} {
				entity.Document = document
				require.NoError(t, d.stmts.ReviseIDPConnection(t.Context(), entity))
			}
		}

		ids := func(items []*domain.IDPConnection) []string {
			got := make([]string, 0, len(items))
			for _, item := range items {
				got = append(got, item.ID)
			}
			return got
		}
		// Every filter is ANDed with the project scope the endpoint always
		// applies.
		list := func(t *testing.T, filter database.Filter[domain.IDPConnectionField], limit uint32) *database.ListResult[*domain.IDPConnection] {
			t.Helper()
			opts := idpConnectionListOptions(projectID)
			opts.Filter = database.And(opts.Filter, filter)
			opts.Pagination.Limit = limit
			result, err := d.stmts.ListIDPConnections(unfilteredListCtx(t), opts)
			require.NoError(t, err)
			return result
		}

		// A slug is unique per project, so equality on it selects one
		// connection, on its newest revision.
		bySlug := list(t, database.Equal(database.Col(domain.IDPConnectionFieldSlug), created[0].Slug), 0)
		require.Len(t, bySlug.Items, 1)
		assert.Equal(t, created[0].ID, bySlug.Items[0].ID)
		assert.Equal(t, created[0].RevisionID, bySlug.Items[0].RevisionID)
		assert.JSONEq(t, string(latest), string(bySlug.Items[0].Document))

		// The bound comes from a stored row, not from what create wrote back:
		// the Spanner emulator's THEN RETURN reports a created_at a few hundred
		// microseconds off the value it commits.
		oldest, err := d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(projectID, created[0].ID))
		require.NoError(t, err)

		after := list(t, database.GreaterThan(database.Col(domain.IDPConnectionFieldCreatedAt), oldest.CreatedAt), 0)
		// created[0] falls outside the bound even though it holds the most
		// recent revision, which is what tells the two created_at columns apart.
		require.Len(t, after.Items, 2)
		assert.Equal(t, idpConnectionIDsInDefaultOrder(created[1:]), ids(after.Items))
		// created[2] was revised twice, so a filtered row still arrives on its
		// newest revision.
		assert.Equal(t, created[2].RevisionID, after.Items[1].RevisionID)
		assert.JSONEq(t, string(latest), string(after.Items[1].Document))

		// An unmatched slug is an empty page rather than an error, and an empty
		// page ends the cursor chain.
		none := list(t, database.Equal(database.Col(domain.IDPConnectionFieldSlug), created[0].Slug+"-nope"), 10)
		assert.Empty(t, none.Items)
		assert.Empty(t, none.NextCursor)
	})
}

// The project foreign key cascades through the connection to its revisions, so
// deleting a project leaves no revision behind.
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
