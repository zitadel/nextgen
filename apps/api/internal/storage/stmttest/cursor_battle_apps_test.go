//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"slices"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/appstore"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// battleApps works like battleIDPConnections: the list joins each app to its
// revisions and keeps only the newest, and a page boundary is where that and
// the keyset predicate can fall out of step. Every app here has a superseded
// revision, so a stale or missing row shows the break.
func battleApps(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	suffix := uniqueSuffix(t)
	created := make([]*domain.App, 0, 5)
	for i := range 5 {
		// Slugs run against creation order, so the slug drain cannot pass on
		// the created_at order by accident.
		slug := "battle-" + suffix + "-" + string(rune('e'-i))
		entity := createApp(t, d.stmts, projectID, slug, domain.AppSourceDeclared, appDocument("v1"))
		reviseApp(t, d, entity, appDocument("v2"))
		created = append(created, entity)
	}

	filter := database.Equal(database.Col(domain.AppFieldProjectID), projectID)
	list := func(page database.Page[domain.AppField]) (*database.ListResult[*domain.App], error) {
		return d.stmts.ListApps(unfilteredListCtx(t), &database.ListOptions[domain.AppField]{
			Filter: filter, Pagination: page,
		})
	}
	id := func(a *domain.App) string { return a.ID }

	orderAsc := database.OrderBy[domain.AppField]{
		Columns: []database.Column[domain.AppField]{
			database.Col(domain.AppFieldCreatedAt),
			database.Col(domain.AppFieldID),
		},
		Direction: database.OrderAsc,
	}
	drainIncarnation(t, appIDsInDefaultOrder(created), orderAsc, list, id, 2)

	// Slug is the other column the endpoint sorts on, and unlike created_at it
	// is a single key with no tiebreaker.
	t.Run("slug_order", func(t *testing.T) {
		bySlug := slices.SortedFunc(slices.Values(created), func(a, b *domain.App) int {
			return strings.Compare(a.Slug, b.Slug)
		})
		orderSlugAsc := database.OrderBy[domain.AppField]{
			Columns:   []database.Column[domain.AppField]{database.Col(domain.AppFieldSlug)},
			Direction: database.OrderAsc,
		}
		drainIncarnation(t, appIDs(bySlug), orderSlugAsc, list, id, 2)
	})
}

// battleAppRevisions pages one app's history: the same join without the
// newest-revision filter, where the keyset sits on the revision row and the
// identity columns come from the app. Each row's id is a revision id.
func battleAppRevisions(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	entity := createApp(t, d.stmts, projectID, "battle-rev-"+uniqueSuffix(t), domain.AppSourceRegistered, appDocument("v0"))
	// Revisions of one app never share an instant, and each revise commits
	// before the next begins, so write order is created_at order.
	want := []string{entity.RevisionID}
	for i := range 5 {
		reviseApp(t, d, entity, appDocument("v"+string(rune('1'+i))))
		want = append(want, entity.RevisionID)
	}

	// The drain walks both directions, so this reuses the newest-first key and
	// only flips the direction.
	orderAsc := appstore.RevisionsNewestFirst()
	orderAsc.Direction = database.OrderAsc
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.AppField]) (*database.ListResult[*domain.App], error) {
		return d.stmts.ListAppRevisions(unfilteredListCtx(t), projectID, entity.ID, page)
	}, func(a *domain.App) string { return a.RevisionID }, 2)
}
