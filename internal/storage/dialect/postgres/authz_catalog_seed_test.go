//go:build postgres_integration

package postgres

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthzCatalogSeed(t *testing.T) {
	ctx := t.Context()

	t.Run("exactly one active system catalog", func(t *testing.T) {
		var id, kind, owner, status string
		var version int
		err := testPool.pool.QueryRow(ctx, `
SELECT id, catalog_kind, owner_id, version, status
FROM zitadel_nextgen.authz_catalogs
WHERE catalog_kind = 'system' AND owner_id = $1 AND status = 'active'`,
			domain.SystemCatalogOwnerID,
		).Scan(&id, &kind, &owner, &version, &status)
		require.NoError(t, err)
		assert.Equal(t, domain.SystemCatalogID, id)
		assert.Equal(t, "system", kind)
		assert.Equal(t, domain.SystemCatalogOwnerID, owner)
		assert.Equal(t, 1, version)
		assert.Equal(t, "active", status)

		var count int
		require.NoError(t, testPool.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM zitadel_nextgen.authz_catalogs
WHERE catalog_kind = 'system' AND owner_id = $1 AND status = 'active'`,
			domain.SystemCatalogOwnerID,
		).Scan(&count))
		assert.Equal(t, 1, count)
	})

	t.Run("typed OpenFGA-style relations present", func(t *testing.T) {
		type typedRel struct {
			objectType string
			relation   string
		}
		want := []typedRel{
			{"team", "member"},
			{"project", "team"},
			{"project", "viewer"},
			{"project", "editor"},
			{"project", "admin"},
		}
		rows, err := testPool.pool.Query(ctx, `
SELECT object_type, relation FROM zitadel_nextgen.authz_relations
WHERE catalog_id = $1 ORDER BY object_type, relation`, domain.SystemCatalogID)
		require.NoError(t, err)
		defer rows.Close()
		var got []typedRel
		for rows.Next() {
			var r typedRel
			require.NoError(t, rows.Scan(&r.objectType, &r.relation))
			got = append(got, r)
		}
		require.NoError(t, rows.Err())
		assert.ElementsMatch(t, want, got)
	})

	t.Run("expression edges and typed closure", func(t *testing.T) {
		var edgeCount int
		require.NoError(t, testPool.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM zitadel_nextgen.authz_expression_edges
WHERE catalog_id = $1`, domain.SystemCatalogID).Scan(&edgeCount))
		assert.Equal(t, 7, edgeCount)

		var refCount int
		require.NoError(t, testPool.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM zitadel_nextgen.authz_relation_references
WHERE catalog_id = $1`, domain.SystemCatalogID).Scan(&refCount))
		assert.Equal(t, 5, refCount)

		var identityCount int
		require.NoError(t, testPool.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM zitadel_nextgen.authz_relation_closure
WHERE catalog_id = $1 AND from_object_type = to_object_type AND from_relation = to_relation AND depth = 0`,
			domain.SystemCatalogID).Scan(&identityCount))
		assert.Equal(t, 5, identityCount)

		var viewerImpliesEditor int
		require.NoError(t, testPool.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM zitadel_nextgen.authz_relation_closure
WHERE catalog_id = $1
  AND from_object_type = 'project' AND from_relation = 'viewer'
  AND to_object_type = 'project' AND to_relation = 'editor'
  AND depth = 1`,
			domain.SystemCatalogID).Scan(&viewerImpliesEditor))
		assert.Equal(t, 1, viewerImpliesEditor)

		var viewerImpliesAdmin int
		require.NoError(t, testPool.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM zitadel_nextgen.authz_relation_closure
WHERE catalog_id = $1
  AND from_object_type = 'project' AND from_relation = 'viewer'
  AND to_object_type = 'project' AND to_relation = 'admin'
  AND depth = 2`,
			domain.SystemCatalogID).Scan(&viewerImpliesAdmin))
		assert.Equal(t, 1, viewerImpliesAdmin)

		var bundleCount int
		require.NoError(t, testPool.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM zitadel_nextgen.authz_bundle_members
WHERE catalog_id = $1`, domain.SystemCatalogID).Scan(&bundleCount))
		assert.Equal(t, 0, bundleCount)
	})
}
