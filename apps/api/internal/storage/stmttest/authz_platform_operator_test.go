//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/authz/openfga"
	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

// systemCatalogModel is what the migrations seed into cat_sys_1, ADR 075's
// platform operator included.
const systemCatalogModel = `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type platform
  relations
    define operator: [user]

type project
  relations
    define team: [team]
    define platform: [platform]
    define admin: [user, team#member] or member from team or operator from platform
    define editor: [user, team#member] or admin
    define viewer: [user, team#member] or editor
`

// TestAuthzSystemCatalogSeedMatchesModel pins the hand-written seed to the
// compiler's reading of the model, so the rows the resolver reads are the
// rows the model means. Positions are left out: the seed orders references
// and edges by hand.
func TestAuthzSystemCatalogSeedMatchesModel(t *testing.T) {
	model, err := openfga.ParseDSL(systemCatalogModel)
	require.NoError(t, err)
	out, err := compiler.Compile(model)
	require.NoError(t, err)
	want := out.Catalog.Persisted()

	forEachDialect(t, func(t *testing.T, d dialect) {
		got, err := d.stmts.LoadCatalogMutations(t.Context(), domain.SystemCatalogID)
		require.NoError(t, err)

		assert.ElementsMatch(t, want.Relations, got.Relations)
		assert.ElementsMatch(t, withoutReferencePositions(want.RelationReferences), withoutReferencePositions(got.RelationReferences))
		assert.ElementsMatch(t, withoutEdgePositions(want.ExpressionEdges), withoutEdgePositions(got.ExpressionEdges))
		assert.ElementsMatch(t, want.Closure, got.Closure)
	})
}

func withoutReferencePositions(refs []compiler.RelationReference) []compiler.RelationReference {
	out := make([]compiler.RelationReference, len(refs))
	for i, ref := range refs {
		ref.Position = 0
		out[i] = ref
	}
	return out
}

func withoutEdgePositions(edges []compiler.ExpressionEdge) []compiler.ExpressionEdge {
	out := make([]compiler.ExpressionEdge, len(edges))
	for i, edge := range edges {
		edge.Position = 0
		out[i] = edge
	}
	return out
}

func TestAuthzPlatformOperator(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		ctx := t.Context()
		// A project of the test's own stands in for the platform project: the
		// operator path reads whichever project the caller names as platform.
		platform, schemaURL := ensureUserTestProject(t, d.stmts)
		customer := ensureProject(t, d.stmts)

		newUser := func(name string) string {
			t.Helper()
			user := newTestUser(t, platform, schemaURL, "", name+"-"+uniqueSuffix(t)+"@example.com", name)
			require.NoError(t, d.stmts.CreateUser(ctx, user))
			return user.ID
		}
		operator := newUser("operator")
		expired := newUser("expired")
		bystander := newUser("bystander")

		grant := domain.NewPlatformOperatorAssignment(platform, operator)
		require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, grant))
		lapsed := domain.NewPlatformOperatorAssignment(platform, expired)
		past := time.Now().Add(-time.Hour)
		lapsed.ExpiresAt = &past
		require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, lapsed))

		listed := []string{"user_pl_a_" + uniqueSuffix(t), "user_pl_b_" + uniqueSuffix(t)}
		for _, id := range listed {
			require.NoError(t, d.stmts.UpsertResourceScope(ctx, domain.NewUserResourceScope(customer, id)))
		}

		ask := func(userID, objectType, relation string) bool {
			t.Helper()
			ok, err := d.stmts.CheckPlatformOperator(ctx, domain.AuthzPlatformCheckParams{
				CatalogID:         domain.SystemCatalogID,
				PlatformProjectID: platform,
				UserID:            userID,
				ObjectType:        objectType,
				Relation:          relation,
			})
			require.NoError(t, err)
			return ok
		}
		listParams := func(userID string) domain.AuthzListObjectsParams {
			return domain.AuthzListObjectsParams{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID:              domain.SystemCatalogID,
					ProjectID:              customer,
					PrincipalHomeProjectID: platform,
					PlatformProjectID:      platform,
					PrincipalType:          domain.AuthzPrincipalTypeUser,
					PrincipalID:            userID,
					ObjectType:             "project",
					Relation:               "viewer",
				},
				ResourceKind: domain.ResourceKindUser,
			}
		}

		t.Run("an operator administers, edits and views every project", func(t *testing.T) {
			for _, relation := range []string{"admin", "editor", "viewer"} {
				assert.True(t, ask(operator, "project", relation), relation)
			}
			assert.False(t, ask(operator, "team", "member"), "only project relations borrow from the platform")
		})

		t.Run("nobody else, and no lapsed grant", func(t *testing.T) {
			assert.False(t, ask(bystander, "project", "viewer"))
			assert.False(t, ask(expired, "project", "viewer"))
		})

		t.Run("CheckAuthz answers from grants only", func(t *testing.T) {
			params := listParams(operator).AuthzCheckParams
			allowed, foothold, err := d.stmts.CheckAuthz(ctx, params)
			require.NoError(t, err)
			assert.False(t, allowed)
			assert.False(t, foothold)
		})

		t.Run("a materialized list agrees with the operator path", func(t *testing.T) {
			ids, err := d.stmts.ListAuthzObjectIDs(ctx, listParams(operator))
			require.NoError(t, err)
			assert.ElementsMatch(t, listed, ids)

			ids, err = d.stmts.ListAuthzObjectIDs(ctx, listParams(bystander))
			require.NoError(t, err)
			assert.Empty(t, ids)

			closed := listParams(operator)
			closed.PlatformProjectID = ""
			ids, err = d.stmts.ListAuthzObjectIDs(ctx, closed)
			require.NoError(t, err)
			assert.Empty(t, ids, "without a platform project there is no operator path")
		})

		t.Run("the oracle agrees", func(t *testing.T) {
			persisted, err := d.stmts.LoadCatalogMutations(ctx, domain.SystemCatalogID)
			require.NoError(t, err)
			g := resolver.GraphFromPersisted(persisted)
			g.Assignments = []*domain.AuthzAssignment{grant, lapsed}
			g.ActiveUsers = map[resolver.UserKey]bool{}
			for _, u := range []string{operator, expired, bystander} {
				g.ActiveUsers[resolver.UserKey{ProjectID: platform, UserID: u}] = true
			}
			for _, u := range []string{operator, expired, bystander} {
				for _, rel := range [][2]string{{"project", "admin"}, {"project", "viewer"}, {"team", "member"}} {
					params := domain.AuthzPlatformCheckParams{
						CatalogID: domain.SystemCatalogID, PlatformProjectID: platform, UserID: u,
						ObjectType: rel[0], Relation: rel[1],
					}
					assert.Equal(t, g.OraclePlatformOperator(params), ask(u, rel[0], rel[1]), "%s %s.%s", u, rel[0], rel[1])
				}
			}
		})

		t.Run("an operator grant outside the platform project does not count", func(t *testing.T) {
			outside := domain.NewPlatformOperatorAssignment(customer, bystander)
			require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, outside))
			assert.False(t, ask(bystander, "project", "viewer"))
		})

		t.Run("storage refuses an operator grant to a team", func(t *testing.T) {
			team := domain.NewPlatformOperatorAssignment(platform, "team_ops_"+uniqueSuffix(t))
			team.PrincipalType = domain.AuthzPrincipalTypeTeam
			assert.ErrorIs(t, d.stmts.CreateAuthzAssignment(ctx, team), authz.ErrPlatformAssignmentShape)
		})

		t.Run("the reconcile lists active operators", func(t *testing.T) {
			got, err := d.stmts.ListActiveAuthzAssignmentsByRelation(ctx, platform, domain.AuthzObjectTypePlatform, domain.AuthzRelationOperator)
			require.NoError(t, err)
			ids := make([]string, 0, len(got))
			for _, a := range got {
				ids = append(ids, a.PrincipalID)
				require.NotNil(t, a.GrantorType)
				assert.Equal(t, domain.AuthzGrantorTypeConfig, *a.GrantorType)
			}
			// Expiry is not consulted; revocation is.
			assert.ElementsMatch(t, []string{operator, expired}, ids)
		})

		t.Run("deactivating the operator ends the access", func(t *testing.T) {
			require.NoError(t, d.stmts.DeactivateUser(ctx, platform, operator))
			assert.False(t, ask(operator, "project", "viewer"))
		})

		t.Run("revoking the grant ends the access", func(t *testing.T) {
			require.NoError(t, d.stmts.RevokeAuthzAssignment(ctx, platform, grant.ID))
			got, err := d.stmts.ListActiveAuthzAssignmentsByRelation(ctx, platform, domain.AuthzObjectTypePlatform, domain.AuthzRelationOperator)
			require.NoError(t, err)
			for _, a := range got {
				assert.NotEqual(t, grant.ID, a.ID)
			}
		})
	})
}
