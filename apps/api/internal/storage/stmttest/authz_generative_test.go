//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/authztest"
	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestPersistCatalogVersion_Generative(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		const attempts = 20

		projectID := ensureProject(t, d.stmts)

		for i := 0; i < attempts; i++ {
			seed := authztest.Seed(i)
			model := authztest.GenerateValidModel(seed)
			output, err := compiler.Compile(model)
			require.NoError(t, err, "seed %d: GenerateValidModel must compile", i)
			require.NotEmpty(t, output.Catalog.Relations, "seed %d: valid type-shape always emits relations", i)

			catalogID := fmt.Sprintf("cat_gen_%s_%d", uniqueSuffix(t), i)
			ownerID := fmt.Sprintf("owner_gen_%s_%d", uniqueSuffix(t), i)
			require.NoError(t, d.stmts.PersistCatalogVersion(t.Context(), domain.AuthzCatalogVersion{
				ID:          catalogID,
				CatalogKind: domain.AuthzCatalogKindAppGroup,
				OwnerID:     ownerID,
				Version:     1,
			}, output.Catalog))

			loaded, err := d.stmts.LoadCatalogMutations(t.Context(), catalogID)
			require.NoError(t, err, "seed %d", i)
			assertPersistedCatalogMatch(t, output.Catalog.Persisted(), loaded)

			first := loaded.Relations[0]
			ok := &domain.AuthzAssignment{
				ID:            fmt.Sprintf("asgn-gen-%s-%d", uniqueSuffix(t), i),
				ProjectID:     projectID,
				CatalogID:     catalogID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_gen",
				ObjectType:    first.Relation.Type,
				Relation:      first.Relation.Name,
			}
			ok.ApplyScope(domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), ok), "seed %d", i)

			bad := &domain.AuthzAssignment{
				ID:            fmt.Sprintf("asgn-bad-%s-%d", uniqueSuffix(t), i),
				ProjectID:     projectID,
				CatalogID:     catalogID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_gen_bad",
				ObjectType:    first.Relation.Type,
				Relation:      "not.a.relation",
			}
			bad.ApplyScope(domain.NewProjectAssignmentScope())
			assert.Error(t, d.stmts.CreateAuthzAssignment(t.Context(), bad), "seed %d", i)
		}
	})
}

func assertPersistedCatalogMatch(t *testing.T, want, got compiler.PersistedCatalog) {
	t.Helper()

	assert.ElementsMatch(t, want.Relations, got.Relations, "relations")
	assert.ElementsMatch(t, want.RelationReferences, got.RelationReferences, "relation references")
	assert.ElementsMatch(t, want.ExpressionEdges, got.ExpressionEdges, "expression edges")
	assert.ElementsMatch(t, want.Closure, got.Closure, "closure")
}
