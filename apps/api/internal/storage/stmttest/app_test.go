//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// appDocument is shaped like the app document, but storage never looks inside
// it: name tells the revisions apart.
func appDocument(name string) []byte {
	return []byte(`{"slug":"web","name":"` + name + `"}`)
}

func createApp(t *testing.T, stmts service.AllStatements, projectID, slug string, source domain.AppSource, document []byte) *domain.App {
	t.Helper()
	entity := &domain.App{ProjectID: projectID, Slug: slug, Source: source, Document: document}
	require.NoError(t, stmts.CreateApp(t.Context(), entity))
	return entity
}

// reviseApp appends document on top of entity the way the service does, under
// the app's lock, and leaves entity at the new revision.
func reviseApp(t *testing.T, d dialect, entity *domain.App, document []byte) {
	t.Helper()
	entity.Document = document
	require.NoError(t, d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		if err := tx.Statements().LockApp(ctx, entity.ProjectID, entity.ID); err != nil {
			return err
		}
		return tx.Statements().ReviseApp(ctx, entity)
	}))
}

// reviseNewestApp is the read-modify-write a revise runs inside tx: lock the
// app, read its newest revision and append document on top of it. It reports
// the revision it read and the one it wrote, per attempt: Spanner replays an
// aborted attempt, and only the committed one counts.
func reviseNewestApp(ctx context.Context, tx service.Statementer[service.AllStatements], projectID, id string, document []byte, read, wrote *domain.App) error {
	if err := tx.Statements().LockApp(ctx, projectID, id); err != nil {
		return err
	}
	current, err := tx.Statements().GetApp(ctx, appByID(projectID, id))
	if err != nil {
		return err
	}
	next := *current
	next.Document = document
	if err := tx.Statements().ReviseApp(ctx, &next); err != nil {
		return err
	}
	*read, *wrote = *current, next
	return nil
}

func appByID(projectID, id string) database.Filter[domain.AppField] {
	return database.And(
		database.Equal(database.Col(domain.AppFieldProjectID), projectID),
		database.Equal(database.Col(domain.AppFieldID), id),
	)
}

func appBySlug(projectID, slug string) database.Filter[domain.AppField] {
	return database.And(
		database.Equal(database.Col(domain.AppFieldProjectID), projectID),
		database.Equal(database.Col(domain.AppFieldSlug), slug),
	)
}

// appListOptions scopes a list to the project, as the endpoint always does,
// and ANDs filters onto that scope.
func appListOptions(projectID string, filters ...database.Filter[domain.AppField]) *database.ListOptions[domain.AppField] {
	scope := []database.Filter[domain.AppField]{database.Equal(database.Col(domain.AppFieldProjectID), projectID)}
	return &database.ListOptions[domain.AppField]{Filter: database.And(append(scope, filters...)...)}
}

func appIDs(apps []*domain.App) []string {
	ids := make([]string, 0, len(apps))
	for _, app := range apps {
		ids = append(ids, app.ID)
	}
	return ids
}

// appIDsInDefaultOrder sorts fixtures by the default list key, created_at then
// id, so an expectation holds when two apps share a timestamp: the id that
// breaks the tie is a UUID on Spanner, unrelated to insertion order.
func appIDsInDefaultOrder(apps []*domain.App) []string {
	return appIDs(slices.SortedFunc(slices.Values(apps), func(a, b *domain.App) int {
		return cmp.Or(a.CreatedAt.Compare(b.CreatedAt), cmp.Compare(a.ID, b.ID))
	}))
}

// assertServedAtNewest checks that each listed app is one of written, on the
// revision written last wrote for it.
func assertServedAtNewest(t *testing.T, written, listed []*domain.App) {
	t.Helper()
	byID := make(map[string]*domain.App, len(written))
	for _, entity := range written {
		byID[entity.ID] = entity
	}
	for _, item := range listed {
		entity, ok := byID[item.ID]
		if !assert.True(t, ok, "listed app %s was never written", item.ID) {
			continue
		}
		assert.Equal(t, entity.Source, item.Source, "app %s", entity.Slug)
		assert.Equal(t, entity.RevisionID, item.RevisionID, "app %s is not on its newest revision", entity.Slug)
		assert.JSONEq(t, string(entity.Document), string(item.Document), "app %s", entity.Slug)
	}
}

func createAppClientID(t *testing.T, stmts service.AllStatements, projectID, appID, slug, clientID string) *domain.AppClientID {
	t.Helper()
	entity := &domain.AppClientID{ProjectID: projectID, AppID: appID, Slug: slug, ClientID: clientID}
	require.NoError(t, stmts.CreateAppClientID(t.Context(), entity))
	return entity
}

func clientRowIDs(rows []*domain.AppClientID) []string {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func secretIDs(secrets []*domain.AppClientSecret) []string {
	ids := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		ids = append(ids, secret.ID)
	}
	return ids
}

// sha256Hash looks like a hash the server writes; storage keeps it opaque.
func sha256Hash(fill string) string {
	return "sha256:" + strings.Repeat(fill, 64)
}

func TestAppStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		// Both writers' apps share the tables, so each source must survive the
		// round trip.
		for _, source := range []domain.AppSource{domain.AppSourceDeclared, domain.AppSourceRegistered} {
			t.Run(string(source), func(t *testing.T) {
				slug := string(source) + "-" + uniqueSuffix(t)
				document := appDocument("v1")
				entity := createApp(t, d.stmts, projectID, slug, source, document)

				// The dialect mints both ids, not the caller (ADR 047), and each
				// carries its own prefix.
				assert.True(t, domain.PrefixApp.Matches(entity.ID), "id %q is not app_-prefixed", entity.ID)
				assert.True(t, domain.PrefixAppRevision.Matches(entity.RevisionID), "revision id %q is not apprev_-prefixed", entity.RevisionID)
				assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
				assert.True(t, entity.CreatedAt.Equal(entity.UpdatedAt), "an app nobody revised must not look edited")

				// The management gate resolves the app's project from this row, so
				// create writes it in the same transaction.
				scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindApp, projectID, entity.ID)
				require.NoError(t, err)
				assert.Equal(t, domain.ResourceKindApp, scope.ResourceKind)
				assert.Equal(t, projectID, scope.ProjectID)
				assert.Nil(t, scope.TeamID)

				for _, read := range []struct {
					name   string
					filter database.Filter[domain.AppField]
				}{
					{"by id", appByID(projectID, entity.ID)},
					{"by slug", appBySlug(projectID, slug)},
				} {
					got, err := d.stmts.GetApp(t.Context(), read.filter)
					require.NoError(t, err, read.name)
					assert.Equal(t, projectID, got.ProjectID, read.name)
					assert.Equal(t, entity.ID, got.ID, read.name)
					assert.Equal(t, slug, got.Slug, read.name)
					assert.Equal(t, source, got.Source, read.name)
					assert.Equal(t, entity.RevisionID, got.RevisionID, read.name)
					// Spanner re-serializes the document, so the assertion
					// compares JSON rather than bytes.
					assert.JSONEq(t, string(document), string(got.Document), read.name)
					assert.True(t, got.UpdatedAt.Equal(entity.UpdatedAt), "%s: create must report the timestamp a read serves", read.name)
					assert.True(t, got.CreatedAt.Equal(got.UpdatedAt), "%s: an app nobody revised must not read as edited", read.name)
				}

				pinned, err := d.stmts.GetAppRevision(t.Context(), projectID, entity.RevisionID)
				require.NoError(t, err)
				assert.Equal(t, entity.ID, pinned.ID)
				assert.Equal(t, slug, pinned.Slug)
				assert.Equal(t, source, pinned.Source)
				assert.Equal(t, entity.RevisionID, pinned.RevisionID)
				assert.JSONEq(t, string(document), string(pinned.Document))
			})
		}
	})
}

// A slug names one app in the project whoever writes it, so a second app cannot
// take it, not even from the other source. Storage reports the collision as a
// *database.UniqueError and leaves the service to decide what to do.
func TestAppStatements_SlugUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "web-" + uniqueSuffix(t)
		first := createApp(t, d.stmts, projectID, slug, domain.AppSourceDeclared, appDocument("v1"))

		dup := &domain.App{ProjectID: projectID, Slug: slug, Source: domain.AppSourceRegistered, Document: appDocument("v2")}
		assert.ErrorIs(t, d.stmts.CreateApp(t.Context(), dup), new(database.UniqueError))

		got, err := d.stmts.GetApp(t.Context(), appBySlug(projectID, slug))
		require.NoError(t, err)
		assert.Equal(t, first.ID, got.ID, "the losing create must leave the slug with the first app")
		assert.Equal(t, domain.AppSourceDeclared, got.Source)
	})
}

// Two projects may use the same slug, so it is unique per project rather than
// globally.
func TestAppStatements_SlugReusableAcrossProjects(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectA := ensureProject(t, d.stmts)
		projectB := ensureProject(t, d.stmts)
		slug := "shared-" + uniqueSuffix(t)

		appA := createApp(t, d.stmts, projectA, slug, domain.AppSourceDeclared, appDocument("a"))
		appB := createApp(t, d.stmts, projectB, slug, domain.AppSourceDeclared, appDocument("b"))
		assert.NotEqual(t, appA.ID, appB.ID)

		// A read scoped to project A cannot reach project B's app even though
		// the slugs match.
		got, err := d.stmts.GetApp(t.Context(), appBySlug(projectA, slug))
		require.NoError(t, err)
		assert.Equal(t, appA.ID, got.ID)

		_, err = d.stmts.GetApp(t.Context(), appByID(projectA, appB.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// Create writes three rows in one transaction, so a failure must leave nothing
// behind: a retry would otherwise hit the slug of an app that was never
// created.
func TestAppStatements_FailedCreateLeavesNothing(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "rollback-" + uniqueSuffix(t)

		// Valid JSON of the wrong shape: the app insert succeeds and the
		// revision's document CHECK rejects the array, in every dialect.
		entity := &domain.App{ProjectID: projectID, Slug: slug, Source: domain.AppSourceRegistered, Document: []byte(`[]`)}
		require.Error(t, d.stmts.CreateApp(t.Context(), entity))
		// The ids are minted before the write, so they name the rows to look
		// for.
		require.NotEmpty(t, entity.ID)
		require.NotEmpty(t, entity.RevisionID)

		_, err := d.stmts.GetApp(t.Context(), appByID(projectID, entity.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetApp(t.Context(), appBySlug(projectID, slug))
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "the slug must be free for the retry")

		_, err = d.stmts.GetAppRevision(t.Context(), projectID, entity.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindApp, projectID, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "the management gate must not resolve an app that was rolled back")

		retry := createApp(t, d.stmts, projectID, slug, domain.AppSourceRegistered, appDocument("v1"))
		assert.NotEmpty(t, retry.ID)
	})
}

// Revising appends: the reads move to the new revision, which carries the
// greater created_at, while the old one stays readable and unchanged, so a
// release that pinned it keeps reading what it pinned.
func TestAppStatements_ReviseAppendsRevision(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "web-" + uniqueSuffix(t)
		v1, v2 := appDocument("v1"), appDocument("v2")

		entity := createApp(t, d.stmts, projectID, slug, domain.AppSourceRegistered, v1)
		created := *entity
		// Stamps are compared stored to stored: the Spanner emulator's THEN
		// RETURN can report a created_at a little off the value it commits.
		before, err := d.stmts.GetApp(t.Context(), appByID(projectID, entity.ID))
		require.NoError(t, err)

		reviseApp(t, d, entity, v2)
		assert.NotEqual(t, created.RevisionID, entity.RevisionID)
		assert.True(t, domain.PrefixAppRevision.Matches(entity.RevisionID), "revision id %q is not apprev_-prefixed", entity.RevisionID)
		assert.Equal(t, created.ID, entity.ID)
		assert.True(t, entity.CreatedAt.Equal(created.CreatedAt), "a revise leaves CreatedAt as the caller had it")
		assert.False(t, entity.UpdatedAt.Before(entity.CreatedAt), "revising must not move updated_at behind created_at")

		for _, read := range []struct {
			name   string
			filter database.Filter[domain.AppField]
		}{
			{"by id", appByID(projectID, entity.ID)},
			{"by slug", appBySlug(projectID, slug)},
		} {
			got, err := d.stmts.GetApp(t.Context(), read.filter)
			require.NoError(t, err, read.name)
			assert.Equal(t, entity.ID, got.ID, read.name)
			assert.Equal(t, domain.AppSourceRegistered, got.Source, read.name)
			assert.Equal(t, entity.RevisionID, got.RevisionID, read.name)
			assert.JSONEq(t, string(v2), string(got.Document), read.name)
			assert.True(t, got.CreatedAt.Equal(before.CreatedAt), "%s: a revise must not move the app's created_at", read.name)
			assert.True(t, got.UpdatedAt.After(before.UpdatedAt), "%s: the newest revision is the one with the greater created_at", read.name)
		}

		pinned, err := d.stmts.GetAppRevision(t.Context(), projectID, created.RevisionID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, pinned.ID)
		assert.Equal(t, slug, pinned.Slug)
		assert.Equal(t, created.RevisionID, pinned.RevisionID)
		assert.JSONEq(t, string(v1), string(pinned.Document), "an appended revision must not rewrite the one before it")
		assert.True(t, pinned.CreatedAt.Equal(before.CreatedAt), "a revision reports the app's created_at, not its own")
		assert.True(t, pinned.UpdatedAt.Equal(before.UpdatedAt), "a superseded revision keeps its own stamp")

		newest, err := d.stmts.GetAppRevision(t.Context(), projectID, entity.RevisionID)
		require.NoError(t, err)
		assert.JSONEq(t, string(v2), string(newest.Document))
		assert.True(t, newest.UpdatedAt.After(pinned.UpdatedAt))
	})
}

// Revising an app that is not there must fail rather than leave a revision
// without an app. The foreign key catches it and storage reports a not-found.
func TestAppStatements_ReviseUnknownIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)

		err := d.stmts.ReviseApp(t.Context(), &domain.App{
			ProjectID: projectID,
			ID:        "app_does_not_exist",
			Document:  appDocument("nowhere"),
		})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestAppStatements_LockUnknownApp(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return tx.Statements().LockApp(ctx, projectID, "app_missing")
		})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// The revise transaction locks the app row before it reads the newest
// revision, so a second revise of one app reads what the first one wrote.
// Postgres waits on the row lock and SQLite on the write lock BEGIN takes, so B
// cannot commit while A holds the lock. Spanner aborts one of the two and
// replays it; the emulator aborts the open one, so there A often replays after
// B. On every dialect the writer that commits second has read the revision the
// first one committed.
func TestAppStatements_LockSerializesRevisions(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		entity := createApp(t, d.stmts, projectID, "lock-"+uniqueSuffix(t), domain.AppSourceRegistered, appDocument("v1"))

		var locked sync.Once
		lockedCh := make(chan struct{})
		releaseCh := make(chan struct{})
		var readA, wroteA, readB, wroteB domain.App
		errA := make(chan error, 1)
		go func() {
			// No require in here: it would leave lockedCh open and hang the test.
			errA <- d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				if err := tx.Statements().LockApp(ctx, projectID, entity.ID); err != nil {
					return err
				}
				locked.Do(func() { close(lockedCh) })
				<-releaseCh
				return reviseNewestApp(ctx, tx, projectID, entity.ID, appDocument("a"), &readA, &wroteA)
			})
		}()
		select {
		case <-lockedCh:
		case err := <-errA:
			t.Fatalf("transaction A ended before it held the lock: %v", err)
		}

		errB := make(chan error, 1)
		go func() {
			errB <- d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				return reviseNewestApp(ctx, tx, projectID, entity.ID, appDocument("b"), &readB, &wroteB)
			})
		}()
		// The timer checks a lock property only: on Postgres and SQLite, B
		// cannot commit while A holds the lock. It does not decide the order.
		select {
		case err := <-errB:
			if d.name != "spanner" {
				t.Errorf("transaction B committed while A held the lock: %v", err)
			}
			errB <- err
		case <-time.After(200 * time.Millisecond):
		}

		close(releaseCh)
		require.NoError(t, <-errA)
		require.NoError(t, <-errB)

		// The order comes from the reads: the writer that committed second read
		// the other's revision, and the first one read the original.
		var second string
		switch {
		case readB.RevisionID == wroteA.RevisionID:
			assert.Equal(t, entity.RevisionID, readA.RevisionID, "A committed first, so it read the first revision")
			second = wroteB.RevisionID
		case readA.RevisionID == wroteB.RevisionID:
			assert.Equal(t, entity.RevisionID, readB.RevisionID, "B committed first, so it read the first revision")
			second = wroteA.RevisionID
		default:
			t.Fatalf("neither writer read the other's revision: A read %s and wrote %s, B read %s and wrote %s",
				readA.RevisionID, wroteA.RevisionID, readB.RevisionID, wroteB.RevisionID)
		}
		newest, err := d.stmts.GetApp(t.Context(), appByID(projectID, entity.ID))
		require.NoError(t, err)
		assert.Equal(t, second, newest.RevisionID)
	})
}

// A revise whose transaction began before a concurrent one but took the lock
// after it must still stamp its revision after the one it follows. Otherwise
// the newest-by-created_at rule would serve the older write as newest, and the
// late revise's answer would be superseded at once. Postgres' now() is
// transaction-start time, which is why its revise stamps clock_timestamp().
func TestAppStatements_LateReviseInEarlyTransactionStampsLast(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		if d.name == "sqlite" {
			// A single writer: BEGIN IMMEDIATE blocks the early transaction
			// until the late one commits, so the interleaving cannot be built.
			t.Skip("sqlite serializes writers; interleaving not constructible")
		}
		projectID := ensureProject(t, d.stmts)
		entity := createApp(t, d.stmts, projectID, "late-"+uniqueSuffix(t), domain.AppSourceRegistered, appDocument("v1"))

		var begun sync.Once
		begunCh := make(chan struct{})
		proceedCh := make(chan struct{})
		var lateRead, late domain.App
		lateErr := make(chan error, 1)
		go func() {
			// No require in here: it would leave begunCh open and hang the test.
			lateErr <- d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				// A statement fixes the transaction's start before the early
				// revise runs.
				if _, err := tx.Statements().GetApp(ctx, appByID(projectID, entity.ID)); err != nil {
					return err
				}
				// Once per test: Spanner replays aborted attempts.
				begun.Do(func() { close(begunCh) })
				<-proceedCh
				return reviseNewestApp(ctx, tx, projectID, entity.ID, appDocument("late"), &lateRead, &late)
			})
		}()
		select {
		case <-begunCh:
		case err := <-lateErr:
			t.Fatalf("the late transaction ended before it began waiting: %v", err)
		}

		var earlyRead, early domain.App
		earlyErr := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return reviseNewestApp(ctx, tx, projectID, entity.ID, appDocument("early"), &earlyRead, &early)
		})
		close(proceedCh)
		require.NoError(t, earlyErr)
		require.NoError(t, <-lateErr)

		assert.True(t, late.UpdatedAt.After(early.UpdatedAt),
			"the late revise stamped %s, not after the revision it followed (%s)", late.UpdatedAt, early.UpdatedAt)
		newest, err := d.stmts.GetApp(t.Context(), appByID(projectID, entity.ID))
		require.NoError(t, err)
		assert.Equal(t, late.RevisionID, newest.RevisionID, "the late revise must be the newest revision")
	})
}

// Two revises racing on one app without the lock each append a row, and the
// newest is the one with the greater created_at (ADR 063 §7). Two rows on the
// same instant would leave no newest, so the unique index rules that out and
// the loser gets a *database.UniqueError.
func TestAppStatements_ConcurrentReviseAgreesOnNewest(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		v1Document := appDocument("v1")
		documents := [2][]byte{appDocument("v2"), appDocument("v3")}

		entity := createApp(t, d.stmts, projectID, "race-"+uniqueSuffix(t), domain.AppSourceRegistered, v1Document)
		firstRevisionID := entity.RevisionID

		// Each writer revises its own copy: the statement writes RevisionID and
		// UpdatedAt back onto the entity, so a shared struct would be a data
		// race in the test rather than in storage.
		var (
			wg       sync.WaitGroup
			entities [2]domain.App
			errs     [2]error
		)
		for i := range entities {
			entities[i] = *entity
			entities[i].Document = documents[i]
			wg.Go(func() {
				errs[i] = d.stmts.ReviseApp(t.Context(), &entities[i])
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
			pinned, err := d.stmts.GetAppRevision(t.Context(), projectID, revisionID)
			require.NoError(t, err, "revision %q", revisionID)
			assert.Equal(t, entity.ID, pinned.ID)
			assert.JSONEq(t, string(want), string(pinned.Document), "revision %q", revisionID)
		}

		byID, err := d.stmts.GetApp(t.Context(), appByID(projectID, entity.ID))
		require.NoError(t, err)
		assert.Contains(t, landed, byID.RevisionID, "the get serves a revision nobody wrote")
		assert.NotEqual(t, firstRevisionID, byID.RevisionID, "a revise that landed supersedes the first revision")
		assert.JSONEq(t, string(landed[byID.RevisionID]), string(byID.Document))

		// The get and the history must agree on which revision is newest.
		history, err := d.stmts.ListAppRevisions(unfilteredListCtx(t), projectID, entity.ID, database.Page[domain.AppField]{})
		require.NoError(t, err)
		require.Len(t, history.Items, len(landed), "the history pages exactly the revisions that landed")
		assert.Equal(t, byID.RevisionID, history.Items[0].RevisionID, "the newest-first page must open on what the get serves")
		assert.True(t, byID.UpdatedAt.Equal(history.Items[0].UpdatedAt))
	})
}

func TestAppStatements_GetMissesAreNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		slug := "miss-" + uniqueSuffix(t)
		entity := createApp(t, d.stmts, projectID, slug, domain.AppSourceDeclared, appDocument("v1"))

		_, err := d.stmts.GetApp(t.Context(), appByID(projectID, "app_does_not_exist"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetApp(t.Context(), appBySlug(projectID, slug+"-nope"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetApp(t.Context(), appByID(otherProject, entity.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetApp(t.Context(), appBySlug(otherProject, slug))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetAppRevision(t.Context(), otherProject, entity.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetAppRevision(t.Context(), projectID, "apprev_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// The list serves each app once, on its newest revision, oldest app first, and
// only the project's own apps.
func TestAppStatements_ListIsProjectScopedOldestFirstOnNewestRevision(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		created := make([]*domain.App, 0, 3)
		for _, name := range []string{"a", "b", "c"} {
			created = append(created, createApp(t, d.stmts, projectID, name+"-"+suffix, domain.AppSourceDeclared, appDocument(name+"-v1")))
		}
		// The newest app is revised once and the oldest twice, so the oldest
		// app holds the most recent revision of the set and b only its first.
		reviseApp(t, d, created[2], appDocument("c-v2"))
		reviseApp(t, d, created[0], appDocument("a-v2"))
		reviseApp(t, d, created[0], appDocument("a-v3"))
		createApp(t, d.stmts, otherProject, "other-"+suffix, domain.AppSourceDeclared, appDocument("other"))

		result, err := d.stmts.ListApps(unfilteredListCtx(t), appListOptions(projectID))
		require.NoError(t, err)
		// One id per app: a revision that leaked past the newest-revision
		// filter would repeat its app here.
		assert.Equal(t, appIDsInDefaultOrder(created), appIDs(result.Items))
		assertServedAtNewest(t, created, result.Items)
		for _, item := range result.Items {
			assert.Equal(t, projectID, item.ProjectID)
		}
	})
}

// Each app has one writer, and each reader asks for its own: the list filters
// on source, and a filtered row is still on its newest revision.
func TestAppStatements_ListFiltersBySource(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		declared := []*domain.App{createApp(t, d.stmts, projectID, "declared-a-"+suffix, domain.AppSourceDeclared, appDocument("v1"))}
		registered := createApp(t, d.stmts, projectID, "registered-"+suffix, domain.AppSourceRegistered, appDocument("v1"))
		declared = append(declared, createApp(t, d.stmts, projectID, "declared-b-"+suffix, domain.AppSourceDeclared, appDocument("v1")))
		reviseApp(t, d, declared[0], appDocument("v2"))
		reviseApp(t, d, registered, appDocument("v2"))

		list := func(t *testing.T, source domain.AppSource) []*domain.App {
			t.Helper()
			// The endpoint passes the filter value as a plain string.
			result, err := d.stmts.ListApps(unfilteredListCtx(t), appListOptions(projectID,
				database.Equal(database.Col(domain.AppFieldSource), string(source))))
			require.NoError(t, err)
			return result.Items
		}

		gotDeclared := list(t, domain.AppSourceDeclared)
		assert.Equal(t, appIDsInDefaultOrder(declared), appIDs(gotDeclared))
		assertServedAtNewest(t, declared, gotDeclared)

		gotRegistered := list(t, domain.AppSourceRegistered)
		assert.Equal(t, []string{registered.ID}, appIDs(gotRegistered))
		assertServedAtNewest(t, []*domain.App{registered}, gotRegistered)
	})
}

// The history read pages every revision rather than only the newest, newest
// first, and every row carries the app's identity.
func TestAppStatements_ListRevisionsNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		slug := "history-" + uniqueSuffix(t)

		entity := createApp(t, d.stmts, projectID, slug, domain.AppSourceDeclared, appDocument("v1"))
		documents := map[string][]byte{entity.RevisionID: entity.Document}
		// Revisions of one app never share an instant, and each revise commits
		// before the next begins, so write order is created_at order.
		want := []string{entity.RevisionID}
		for _, name := range []string{"v2", "v3"} {
			reviseApp(t, d, entity, appDocument(name))
			documents[entity.RevisionID] = entity.Document
			want = append(want, entity.RevisionID)
		}
		slices.Reverse(want)

		// A revised sibling in the same project proves the app id filter:
		// without it, its revisions would show up in the page below.
		sibling := createApp(t, d.stmts, projectID, "sibling-"+uniqueSuffix(t), domain.AppSourceDeclared, appDocument("sibling-v1"))
		reviseApp(t, d, sibling, appDocument("sibling-v2"))

		stored, err := d.stmts.GetApp(t.Context(), appByID(projectID, entity.ID))
		require.NoError(t, err)

		// An empty page takes the statement's default order.
		result, err := d.stmts.ListAppRevisions(unfilteredListCtx(t), projectID, entity.ID, database.Page[domain.AppField]{})
		require.NoError(t, err)
		got := make([]string, 0, len(result.Items))
		for i, item := range result.Items {
			got = append(got, item.RevisionID)
			// Identity comes from the app, so only the document, the revision
			// id and updated_at vary down the page.
			assert.Equal(t, entity.ID, item.ID)
			assert.Equal(t, slug, item.Slug)
			assert.Equal(t, domain.AppSourceDeclared, item.Source)
			assert.True(t, item.CreatedAt.Equal(stored.CreatedAt), "every revision reports the app's created_at")
			assert.JSONEq(t, string(documents[item.RevisionID]), string(item.Document), "revision %q", item.RevisionID)
			if i > 0 {
				assert.True(t, result.Items[i-1].UpdatedAt.After(item.UpdatedAt), "revision %q is not older than the one before it", item.RevisionID)
			}
		}
		assert.Equal(t, want, got)
		assert.Empty(t, result.NextCursor)

		// An unknown app is an empty page rather than an error, so the handler
		// needs a get to tell it from an app with no revisions.
		missing, err := d.stmts.ListAppRevisions(unfilteredListCtx(t), projectID, "app_does_not_exist", database.Page[domain.AppField]{})
		require.NoError(t, err)
		assert.Empty(t, missing.Items)

		// The project scopes the read, so another project reaches nothing.
		crossProject, err := d.stmts.ListAppRevisions(unfilteredListCtx(t), otherProject, entity.ID, database.Page[domain.AppField]{})
		require.NoError(t, err)
		assert.Empty(t, crossProject.Items)
	})
}

// A client_id the server mints is the client row's own id, so no caller picks a
// primary key; a client_id the document chose sits beside a minted row id
// (ADR 047 §4). The token endpoint finds either by client_id alone.
func TestAppStatements_ClientIDMintedOrChosen(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		app := createApp(t, d.stmts, projectID, "web-"+suffix, domain.AppSourceDeclared, appDocument("v1"))

		minted := createAppClientID(t, d.stmts, projectID, app.ID, "spa", "")
		assert.True(t, domain.PrefixAppClient.Matches(minted.ID), "row id %q is not client_-prefixed", minted.ID)
		assert.Equal(t, minted.ID, minted.ClientID, "an empty client_id takes the row id")
		assert.WithinDuration(t, time.Now(), minted.CreatedAt, 5*time.Second)

		chosenClientID := "backend-" + suffix
		chosen := createAppClientID(t, d.stmts, projectID, app.ID, "backend", chosenClientID)
		assert.True(t, domain.PrefixAppClient.Matches(chosen.ID), "row id %q is not client_-prefixed", chosen.ID)
		assert.Equal(t, chosenClientID, chosen.ClientID, "a chosen client_id is kept")

		for _, want := range []*domain.AppClientID{minted, chosen} {
			got, err := d.stmts.GetAppClientIDByClientID(t.Context(), projectID, want.ClientID)
			require.NoError(t, err, "client %s", want.Slug)
			assert.Equal(t, projectID, got.ProjectID, "client %s", want.Slug)
			assert.Equal(t, want.ID, got.ID, "client %s", want.Slug)
			assert.Equal(t, app.ID, got.AppID, "client %s", want.Slug)
			assert.Equal(t, want.Slug, got.Slug, "client %s", want.Slug)
			assert.Equal(t, want.ClientID, got.ClientID, "client %s", want.Slug)
			// Not Equal: the Spanner emulator's THEN RETURN can report a
			// created_at a little off the value it commits.
			assert.WithinDuration(t, want.CreatedAt, got.CreatedAt, time.Second, "client %s", want.Slug)
		}

		// The lookup is by client_id: a chosen client's row id is not its
		// client_id.
		_, err := d.stmts.GetAppClientIDByClientID(t.Context(), projectID, chosen.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetAppClientIDByClientID(t.Context(), projectID, "client_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		// The project scopes the lookup.
		_, err = d.stmts.GetAppClientIDByClientID(t.Context(), otherProject, chosenClientID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A client_id names one client for the life of the project, so no other client
// in the project may take it, whichever app it belongs to.
func TestAppStatements_ClientIDUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		web := createApp(t, d.stmts, projectID, "web-"+suffix, domain.AppSourceDeclared, appDocument("web"))
		api := createApp(t, d.stmts, projectID, "api-"+suffix, domain.AppSourceDeclared, appDocument("api"))
		clientID := "shared-" + suffix
		holder := createAppClientID(t, d.stmts, projectID, web.ID, "spa", clientID)

		// Another slug, so only the client_id can collide.
		sameApp := &domain.AppClientID{ProjectID: projectID, AppID: web.ID, Slug: "native", ClientID: clientID}
		assert.ErrorIs(t, d.stmts.CreateAppClientID(t.Context(), sameApp), new(database.UniqueError), "the same app")

		otherApp := &domain.AppClientID{ProjectID: projectID, AppID: api.ID, Slug: "spa", ClientID: clientID}
		assert.ErrorIs(t, d.stmts.CreateAppClientID(t.Context(), otherApp), new(database.UniqueError), "another app of the project")

		got, err := d.stmts.GetAppClientIDByClientID(t.Context(), projectID, clientID)
		require.NoError(t, err)
		assert.Equal(t, holder.ID, got.ID, "a losing create must leave the client_id with its holder")
		assert.Equal(t, web.ID, got.AppID)

		// Another project may hold the same client_id.
		elsewhere := createApp(t, d.stmts, otherProject, "web-"+suffix, domain.AppSourceDeclared, appDocument("web"))
		createAppClientID(t, d.stmts, otherProject, elsewhere.ID, "spa", clientID)
	})
}

// A client's row outlives the revisions that list it, so the list reads the
// rows, not the newest document: oldest first, one app's only.
func TestAppStatements_ListAppClientIDsOldestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		app := createApp(t, d.stmts, projectID, "web-"+suffix, domain.AppSourceDeclared, appDocument("three clients"))
		sibling := createApp(t, d.stmts, projectID, "sibling-"+suffix, domain.AppSourceDeclared, appDocument("one client"))

		// Gaps between the writes give the rows distinct created_at values, so
		// write order is the order to expect.
		var want []string
		for i, client := range []struct{ slug, clientID string }{
			{"spa", ""},
			{"backend", "backend-" + suffix},
			{"cli", ""},
		} {
			if i > 0 {
				time.Sleep(2 * time.Millisecond)
			}
			want = append(want, createAppClientID(t, d.stmts, projectID, app.ID, client.slug, client.clientID).ID)
		}
		createAppClientID(t, d.stmts, projectID, sibling.ID, "spa", "")

		// The newest revision lists no client any more; the rows stay, so a
		// client added back gets its client_id again.
		reviseApp(t, d, app, appDocument("no clients"))

		rows, err := d.stmts.ListAppClientIDs(t.Context(), projectID, app.ID)
		require.NoError(t, err)
		assert.Equal(t, want, clientRowIDs(rows))
		for _, row := range rows {
			assert.Equal(t, projectID, row.ProjectID)
			assert.Equal(t, app.ID, row.AppID)
			assert.NotEmpty(t, row.ClientID)
		}

		unknown, err := d.stmts.ListAppClientIDs(t.Context(), projectID, "app_does_not_exist")
		require.NoError(t, err)
		assert.Empty(t, unknown)

		crossProject, err := d.stmts.ListAppClientIDs(t.Context(), otherProject, app.ID)
		require.NoError(t, err)
		assert.Empty(t, crossProject)
	})
}

// An API identifier is one audience, so once an app holds it no app in the
// project may take it again, the same app included: a token minted for the old
// API must never be accepted by a new one.
func TestAppStatements_APIIdentifierHeldForGood(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		api := createApp(t, d.stmts, projectID, "api-"+suffix, domain.AppSourceDeclared, appDocument("api"))
		other := createApp(t, d.stmts, projectID, "other-"+suffix, domain.AppSourceRegistered, appDocument("other"))
		identifier := "https://api.example.com/" + suffix

		entity := &domain.AppAPIIdentifier{ProjectID: projectID, Identifier: identifier, AppID: api.ID}
		require.NoError(t, d.stmts.CreateAppAPIIdentifier(t.Context(), entity))
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)

		got, err := d.stmts.GetAppAPIIdentifier(t.Context(), projectID, identifier)
		require.NoError(t, err)
		assert.Equal(t, projectID, got.ProjectID)
		assert.Equal(t, identifier, got.Identifier)
		assert.Equal(t, api.ID, got.AppID)
		// Not Equal: the Spanner emulator's THEN RETURN can report a created_at
		// a little off the value it commits.
		assert.WithinDuration(t, entity.CreatedAt, got.CreatedAt, time.Second)

		for _, appID := range []string{api.ID, other.ID} {
			dup := &domain.AppAPIIdentifier{ProjectID: projectID, Identifier: identifier, AppID: appID}
			assert.ErrorIs(t, d.stmts.CreateAppAPIIdentifier(t.Context(), dup), new(database.UniqueError), "app %s", appID)
		}
		got, err = d.stmts.GetAppAPIIdentifier(t.Context(), projectID, identifier)
		require.NoError(t, err)
		assert.Equal(t, api.ID, got.AppID, "a losing create must leave the identifier with its app")

		// Another project may serve the same identifier, and each project reads
		// its own row.
		elsewhere := createApp(t, d.stmts, otherProject, "api-"+suffix, domain.AppSourceDeclared, appDocument("api"))
		require.NoError(t, d.stmts.CreateAppAPIIdentifier(t.Context(), &domain.AppAPIIdentifier{ProjectID: otherProject, Identifier: identifier, AppID: elsewhere.ID}))
		got, err = d.stmts.GetAppAPIIdentifier(t.Context(), otherProject, identifier)
		require.NoError(t, err)
		assert.Equal(t, elsewhere.ID, got.AppID)

		_, err = d.stmts.GetAppAPIIdentifier(t.Context(), projectID, identifier+"/nope")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A registered app's client keeps its secrets as hashes, newest first, and an
// imported hash is replaced by the server's own on its first use.
func TestAppStatements_ClientSecrets(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		app := createApp(t, d.stmts, projectID, "registered-"+uniqueSuffix(t), domain.AppSourceRegistered, appDocument("v1"))
		client := createAppClientID(t, d.stmts, projectID, app.ID, "backend", "")
		otherClient := createAppClientID(t, d.stmts, projectID, app.ID, "worker", "")

		const imported = "$argon2id$v=19$m=65536,t=1,p=4$c2FsdHNhbHQ$aGFzaGhhc2g"
		hashes := []string{sha256Hash("a"), imported, sha256Hash("b")}
		written := make([]*domain.AppClientSecret, 0, len(hashes))
		for i, hash := range hashes {
			// Gaps between the writes give the secrets distinct created_at
			// values, so write order decides the order to expect.
			if i > 0 {
				time.Sleep(2 * time.Millisecond)
			}
			secret := &domain.AppClientSecret{ProjectID: projectID, ClientRowID: client.ID, EncodedHash: hash}
			require.NoError(t, d.stmts.CreateAppClientSecret(t.Context(), secret))
			assert.True(t, domain.PrefixAppClientSecret.Matches(secret.ID), "id %q is not csec_-prefixed", secret.ID)
			assert.WithinDuration(t, time.Now(), secret.CreatedAt, 5*time.Second)
			written = append(written, secret)
		}
		// Another client's secret proves the client filter.
		require.NoError(t, d.stmts.CreateAppClientSecret(t.Context(), &domain.AppClientSecret{ProjectID: projectID, ClientRowID: otherClient.ID, EncodedHash: sha256Hash("c")}))

		newestFirst := []string{written[2].ID, written[1].ID, written[0].ID}
		listed, err := d.stmts.ListAppClientSecrets(t.Context(), projectID, client.ID)
		require.NoError(t, err)
		require.Equal(t, newestFirst, secretIDs(listed))
		for i, secret := range listed {
			assert.Equal(t, projectID, secret.ProjectID)
			assert.Equal(t, client.ID, secret.ClientRowID)
			assert.Equal(t, hashes[len(hashes)-1-i], secret.EncodedHash, "secret %s", secret.ID)
		}

		rehashed := sha256Hash("d")
		require.NoError(t, d.stmts.UpdateAppClientSecretHash(t.Context(), projectID, written[1].ID, rehashed))
		listed, err = d.stmts.ListAppClientSecrets(t.Context(), projectID, client.ID)
		require.NoError(t, err)
		// The update replaces the hash only: the secret keeps its place.
		require.Equal(t, newestFirst, secretIDs(listed))
		for i, want := range []string{hashes[2], rehashed, hashes[0]} {
			assert.Equal(t, want, listed[i].EncodedHash, "secret %s", listed[i].ID)
		}

		err = d.stmts.UpdateAppClientSecretHash(t.Context(), projectID, "csec_does_not_exist", rehashed)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		err = d.stmts.UpdateAppClientSecretHash(t.Context(), otherProject, written[0].ID, rehashed)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "the project scopes the update")

		none, err := d.stmts.ListAppClientSecrets(t.Context(), projectID, "client_does_not_exist")
		require.NoError(t, err)
		assert.Empty(t, none)
	})
}

// The project foreign key cascades through the app to everything under it: its
// revisions, its client rows and their secrets, and its API identifiers.
func TestAppStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "cascade-" + uniqueSuffix(t)
		entity := createApp(t, d.stmts, projectID, slug, domain.AppSourceRegistered, appDocument("v1"))
		firstRevisionID := entity.RevisionID
		reviseApp(t, d, entity, appDocument("v2"))
		client := createAppClientID(t, d.stmts, projectID, entity.ID, "backend", "")
		secret := &domain.AppClientSecret{ProjectID: projectID, ClientRowID: client.ID, EncodedHash: sha256Hash("a")}
		require.NoError(t, d.stmts.CreateAppClientSecret(t.Context(), secret))
		identifier := "https://cascade.example.com/" + slug
		require.NoError(t, d.stmts.CreateAppAPIIdentifier(t.Context(), &domain.AppAPIIdentifier{ProjectID: projectID, Identifier: identifier, AppID: entity.ID}))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		apps, err := d.stmts.ListApps(unfilteredListCtx(t), appListOptions(projectID))
		require.NoError(t, err)
		assert.Empty(t, apps.Items)

		// The side tables are read without the app row, so these reads see a
		// row the cascade left behind.
		clients, err := d.stmts.ListAppClientIDs(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Empty(t, clients)
		_, err = d.stmts.GetAppClientIDByClientID(t.Context(), projectID, client.ClientID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		secrets, err := d.stmts.ListAppClientSecrets(t.Context(), projectID, client.ID)
		require.NoError(t, err)
		assert.Empty(t, secrets)
		_, err = d.stmts.GetAppAPIIdentifier(t.Context(), projectID, identifier)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		// Revisions are read through their app, so a revision left behind would
		// only show once the app is back: recreate the project and the app
		// under their old ids. ensureProject's cleanup removes them again.
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		again := &domain.App{ProjectID: projectID, ID: entity.ID, Slug: slug, Source: domain.AppSourceRegistered, Document: appDocument("again")}
		require.NoError(t, d.stmts.CreateApp(t.Context(), again))
		history, err := d.stmts.ListAppRevisions(unfilteredListCtx(t), projectID, entity.ID, database.Page[domain.AppField]{})
		require.NoError(t, err)
		require.Len(t, history.Items, 1, "a revision of the deleted app survived its project")
		assert.Equal(t, again.RevisionID, history.Items[0].RevisionID)
		for _, revisionID := range []string{firstRevisionID, entity.RevisionID} {
			_, err = d.stmts.GetAppRevision(t.Context(), projectID, revisionID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError), "revision %q", revisionID)
		}
	})
}
