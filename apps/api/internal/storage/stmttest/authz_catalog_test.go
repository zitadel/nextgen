//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/authz/openfga"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

const sampleCatalogOpenFGAModel = `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define viewer: [user, team#member] or member from team
    define editor: viewer
    define admin: [user] or editor
`

func TestPersistCatalogVersion_CompileRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		model, err := openfga.ParseDSL(`model
  schema 1.1

type user

type document
  relations
    define viewer: [user]
`)
		require.NoError(t, err)
		output, err := compiler.Compile(model)
		require.NoError(t, err)

		ownerID := fmt.Sprintf("owner_%s", uniqueSuffix(t))
		catalogID := fmt.Sprintf("cat_app_%s", uniqueSuffix(t))
		require.NoError(t, d.stmts.PersistCatalogVersion(t.Context(), domain.AuthzCatalogVersion{
			ID: catalogID, CatalogKind: domain.AuthzCatalogKindAppGroup, OwnerID: ownerID, Version: 1,
		}, output.Catalog))

		projectID := ensureProject(t, d.stmts)
		a := &domain.AuthzAssignment{
			ID: "asgn-" + uniqueSuffix(t), ProjectID: projectID, CatalogID: catalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "user_viewer",
			ObjectType: "document", Relation: "viewer",
		}
		a.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))

		nextID := fmt.Sprintf("cat_app_%s", uniqueSuffix(t))
		require.NoError(t, d.stmts.PersistCatalogVersion(t.Context(), domain.AuthzCatalogVersion{
			ID: nextID, CatalogKind: domain.AuthzCatalogKindAppGroup, OwnerID: ownerID, Version: 2,
		}, output.Catalog))

		a2 := &domain.AuthzAssignment{
			ID: "asgn-" + uniqueSuffix(t), ProjectID: projectID, CatalogID: nextID,
			PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "user_viewer2",
			ObjectType: "document", Relation: "viewer",
		}
		a2.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a2))
	})
}

func TestPersistCatalogVersion_DeepRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		ctx := t.Context()

		model, err := openfga.ParseDSL(sampleCatalogOpenFGAModel)
		require.NoError(t, err)
		output, err := compiler.Compile(model)
		require.NoError(t, err)

		catalogID := fmt.Sprintf("cat_app_%s", uniqueSuffix(t))
		ownerID := fmt.Sprintf("owner_%s", uniqueSuffix(t))
		require.NoError(t, d.stmts.PersistCatalogVersion(ctx, domain.AuthzCatalogVersion{
			ID: catalogID, CatalogKind: domain.AuthzCatalogKindAppGroup, OwnerID: ownerID, Version: 1,
		}, output.Catalog))

		got, err := d.stmts.GetAuthzCatalog(ctx, catalogID)
		require.NoError(t, err)
		assert.Equal(t, catalogID, got.ID)
		assert.Equal(t, domain.AuthzCatalogKindAppGroup, got.CatalogKind)
		assert.Equal(t, ownerID, got.OwnerID)
		assert.Equal(t, 1, got.Version)
		assert.Equal(t, domain.AuthzCatalogStatusActive, got.Status)

		t.Run("relations", func(t *testing.T) {
			want := make([]domain.AuthzRelation, 0, len(output.Catalog.Relations))
			for _, rel := range output.Catalog.Relations {
				want = append(want, domain.AuthzRelation{
					ObjectType: rel.Relation.Type,
					Relation:   rel.Relation.Name,
					Kind:       domain.AuthzRelationKindRelation,
				})
			}
			assert.ElementsMatch(t, want, got.Relations)
		})

		t.Run("relation references", func(t *testing.T) {
			want := make([]domain.AuthzRelationReference, 0, len(output.Catalog.RelationReferences))
			for _, ref := range output.Catalog.RelationReferences {
				want = append(want, domain.AuthzRelationReference{
					ObjectType:  ref.Relation.Type,
					Relation:    ref.Relation.Name,
					RefType:     ref.Reference.Type,
					RefRelation: ref.Reference.Relation,
					Wildcard:    ref.Reference.Wildcard,
					Condition:   ref.Reference.Condition,
					Position:    ref.Position,
				})
			}
			assert.Equal(t, want, got.References)
		})

		t.Run("expression edges", func(t *testing.T) {
			require.Len(t, got.Edges, len(output.Catalog.ExpressionEdges))
			for i, edge := range output.Catalog.ExpressionEdges {
				assert.Equal(t, edge.Target.Type, got.Edges[i].ObjectType)
				assert.Equal(t, edge.Target.Name, got.Edges[i].Relation)
				assert.Equal(t, edge.Position, got.Edges[i].Position)
				wantKind, err := authz.ExpressionEdgeKind(edge.Kind)
				require.NoError(t, err)
				assert.Equal(t, wantKind, got.Edges[i].Kind)
				assert.Equal(t, authz.EmptyToNil(edge.Source.Type), got.Edges[i].SourceObjectType)
				assert.Equal(t, authz.EmptyToNil(edge.Source.Name), got.Edges[i].SourceRelation)
				assert.Equal(t, authz.EmptyToNil(edge.Tupleset.Type), got.Edges[i].TuplesetObjectType)
				assert.Equal(t, authz.EmptyToNil(edge.Tupleset.Name), got.Edges[i].TuplesetRelation)
			}
		})

		t.Run("closure", func(t *testing.T) {
			want := make([]domain.AuthzRelationClosure, 0, len(output.Catalog.Closure))
			for _, impl := range output.Catalog.Closure {
				want = append(want, domain.AuthzRelationClosure{
					FromObjectType: impl.Source.Type,
					FromRelation:   impl.Source.Name,
					ToObjectType:   impl.Implied.Type,
					ToRelation:     impl.Implied.Name,
					Depth:          impl.Depth,
				})
			}
			assert.ElementsMatch(t, want, got.Closure)
		})

		t.Run("retires previous active catalog", func(t *testing.T) {
			nextID := fmt.Sprintf("cat_app_%s", uniqueSuffix(t))
			require.NoError(t, d.stmts.PersistCatalogVersion(ctx, domain.AuthzCatalogVersion{
				ID: nextID, CatalogKind: domain.AuthzCatalogKindAppGroup, OwnerID: ownerID, Version: 2,
			}, output.Catalog))

			prev, err := d.stmts.GetAuthzCatalog(ctx, catalogID)
			require.NoError(t, err)
			next, err := d.stmts.GetAuthzCatalog(ctx, nextID)
			require.NoError(t, err)
			assert.Equal(t, domain.AuthzCatalogStatusRetired, prev.Status)
			assert.Equal(t, domain.AuthzCatalogStatusActive, next.Status)
		})
	})
}
