//go:build spanner_integration

package spanner

import (
	"testing"

	"cloud.google.com/go/spanner"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthzCatalogSeed(t *testing.T) {
	ctx := t.Context()
	db := newClientDB(testClient.client)

	t.Run("exactly one active system catalog", func(t *testing.T) {
		var id, kind, owner, status string
		var version int64
		err := db.Query(ctx, buildStatement(`
SELECT id, catalog_kind, owner_id, version, status
FROM authz_catalogs
WHERE catalog_kind = @p1 AND owner_id = @p2 AND status = @p3`,
			"system", domain.SystemCatalogOwnerID, "active",
		).statement(), func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				return row.Columns(&id, &kind, &owner, &version, &status)
			})
		})
		require.NoError(t, err)
		assert.Equal(t, domain.SystemCatalogID, id)
		assert.Equal(t, int64(1), version)
	})

	t.Run("typed OpenFGA-style relations and closure", func(t *testing.T) {
		type typedRel struct {
			objectType string
			relation   string
		}
		var relations []typedRel
		err := db.Query(ctx, buildStatement(`
SELECT object_type, relation FROM authz_relations WHERE catalog_id = @p1`, domain.SystemCatalogID,
		).statement(), func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				var r typedRel
				if err := row.Columns(&r.objectType, &r.relation); err != nil {
					return err
				}
				relations = append(relations, r)
				return nil
			})
		})
		require.NoError(t, err)
		assert.ElementsMatch(t, []typedRel{
			{"team", "member"},
			{"project", "team"},
			{"project", "viewer"},
			{"project", "editor"},
			{"project", "admin"},
		}, relations)

		var identityCount int64
		err = db.Query(ctx, buildStatement(`
SELECT COUNT(1) FROM authz_relation_closure
WHERE catalog_id = @p1
  AND from_object_type = to_object_type
  AND from_relation = to_relation
  AND depth = 0`, domain.SystemCatalogID,
		).statement(), func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				return row.Columns(&identityCount)
			})
		})
		require.NoError(t, err)
		assert.Equal(t, int64(5), identityCount)

		var edgeCount int64
		err = db.Query(ctx, buildStatement(`
SELECT COUNT(1) FROM authz_expression_edges WHERE catalog_id = @p1`, domain.SystemCatalogID,
		).statement(), func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				return row.Columns(&edgeCount)
			})
		})
		require.NoError(t, err)
		assert.Equal(t, int64(7), edgeCount)
	})
}
