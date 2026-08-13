//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestProjectStatements_StringFilters(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		specialName := `acme_100%_a\b`
		special := &domain.Project{ID: uniqueProjectID(t), Name: specialName, PreviewOrigins: []string{}}
		cased := &domain.Project{ID: uniqueProjectID(t), Name: "AcmeCorp", PreviewOrigins: []string{}}
		neighbor := &domain.Project{ID: uniqueProjectID(t), Name: "acmeX100ZaWb", PreviewOrigins: []string{}}

		for _, p := range []*domain.Project{special, cased, neighbor} {
			require.NoError(t, d.stmts.CreateProject(t.Context(), p))
			id := p.ID
			t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), id) })
		}

		nameCol := database.Col(domain.ProjectFieldName)
		idCol := database.Col(domain.ProjectFieldID)
		onlyFixtures := database.Or(
			database.Equal(idCol, special.ID),
			database.Equal(idCol, cased.ID),
			database.Equal(idCol, neighbor.ID),
		)
		orderByID := database.Page[domain.ProjectField]{
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{idCol},
			},
		}

		list := func(t *testing.T, filter database.Filter[domain.ProjectField]) []string {
			t.Helper()
			res, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     database.And(onlyFixtures, filter),
				Pagination: orderByID,
			})
			require.NoError(t, err)
			return projectIDs(res.Items)
		}

		t.Run("contains escapes percent underscore and backslash", func(t *testing.T) {
			assert.Equal(t, []string{special.ID}, list(t, database.StringContains(nameCol, `100%_a\b`)))
			assert.Empty(t, list(t, database.StringContains(nameCol, "100Ya")))
			assert.Equal(t, []string{special.ID}, list(t, database.StringContainsFold(nameCol, `100%_A\b`)))
		})

		t.Run("starts with and ends with match literals", func(t *testing.T) {
			assert.Equal(t, []string{special.ID}, list(t, database.StringStartsWith(nameCol, "acme_100")))
			assert.Equal(t, []string{special.ID}, list(t, database.StringEndsWith(nameCol, `a\b`)))
		})

		t.Run("case sensitive contains misses wrong case", func(t *testing.T) {
			onlyCased := database.Equal(idCol, cased.ID)
			res, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     database.And(onlyCased, database.StringContains(nameCol, "acmecorp")),
				Pagination: orderByID,
			})
			require.NoError(t, err)
			assert.Empty(t, projectIDs(res.Items))

			res, err = d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     database.And(onlyCased, database.StringContainsFold(nameCol, "acmecorp")),
				Pagination: orderByID,
			})
			require.NoError(t, err)
			assert.Equal(t, []string{cased.ID}, projectIDs(res.Items))
		})

		t.Run("non-ascii same-case contains fold matches", func(t *testing.T) {
			// SQLite LOWER is ASCII-only; ignore-case LIKE must fold in SQL too.
			uebung := &domain.Project{ID: uniqueProjectID(t), Name: "Übung", PreviewOrigins: []string{}}
			require.NoError(t, d.stmts.CreateProject(t.Context(), uebung))
			t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), uebung.ID) })

			only := database.Equal(idCol, uebung.ID)
			res, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     database.And(only, database.StringEqualFold(nameCol, "Übung")),
				Pagination: orderByID,
			})
			require.NoError(t, err)
			assert.Equal(t, []string{uebung.ID}, projectIDs(res.Items))

			res, err = d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     database.And(only, database.StringContainsFold(nameCol, "Übung")),
				Pagination: orderByID,
			})
			require.NoError(t, err)
			assert.Equal(t, []string{uebung.ID}, projectIDs(res.Items))
		})

		t.Run("non-ASCII contains fold matches itself", func(t *testing.T) {
			// Go's ToLower folds İ to a plain i, but SQLite's LOWER keeps it and
			// a full-Unicode LOWER yields i plus a combining dot. Only folding
			// the needle in the database matches the stored row on every dialect.
			ist := &domain.Project{ID: uniqueProjectID(t), Name: "İstanbul", PreviewOrigins: []string{}}
			require.NoError(t, d.stmts.CreateProject(t.Context(), ist))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), ist.ID) })

			only := database.Equal(idCol, ist.ID)
			res, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     database.And(only, database.StringContainsFold(nameCol, "İstanbul")),
				Pagination: orderByID,
			})
			require.NoError(t, err)
			assert.Equal(t, []string{ist.ID}, projectIDs(res.Items))
		})
	})
}
