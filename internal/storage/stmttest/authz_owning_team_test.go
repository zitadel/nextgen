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
)

// ADR 053 §3's profile fragment (minus `sk_proj`, irrelevant here), plus one
// synthetic relation.
//
// `admin` derives from the owning team's *owner* relation, which is the rule
// under test. `participant` derives from the same tupleset through *member*
// instead, and exists only so a control can vary the source relation while
// holding every other input identical — same tupleset row, same
// tuple-to-userset machinery, same principal. It is not part of ADR 053.
const owningTeamOpenFGAModel = `model
  schema 1.1

type user

type team
  relations
    define owner: [user]
    define member: [user]

type project
  relations
    define owning_team: [team]
    define admin: [user, team#member] or owner from owning_team
    define editor: [user, team#member] or admin
    define viewer: [user, team#member] or editor
    define participant: [user] or member from owning_team
`

// TestAuthzOwningTeamOwnerInheritsProjectAdmin pins both halves of [ADR 053]
// §3 — "team owners inherit; contributors do not" — against the portable
// resolver, under the storage shape ADRs 052 and 053 jointly specify:
//
//   - `project.owning_team` is stored on the **protected** project and names a
//     foreign platform team (053 §2);
//   - `team.owner` is stored at the team's **home** scope, as an assignment
//     distinct from roster membership (053 §1);
//   - the humans are platform-homed and hold nothing in the protected project
//     (052 §1).
//
// Alice owns the team; Bob only participates. The controls vary one input at a
// time, so a failure localizes rather than merely reporting red:
//
//	                  source relation   projects      expected
//	control 1         member            cross         allow
//	control 2         owner             co-located    allow
//	contributor       owner             cross         deny   <- must stay deny
//	the finding       owner             cross         allow  <- fails today
//
// [ADR 053]: ../../../docs/adrs/053-customer-collaboration-grants.md
func TestAuthzOwningTeamOwnerInheritsProjectAdmin(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		ctx := t.Context()

		model, err := openfga.ParseDSL(owningTeamOpenFGAModel)
		require.NoError(t, err)
		output, err := compiler.Compile(model)
		require.NoError(t, err)

		catalogID := fmt.Sprintf("cat_app_%s", uniqueSuffix(t))
		require.NoError(t, d.stmts.PersistCatalogVersion(ctx, domain.AuthzCatalogVersion{
			ID:          catalogID,
			CatalogKind: domain.AuthzCatalogKindAppGroup,
			OwnerID:     fmt.Sprintf("owner_%s", uniqueSuffix(t)),
			Version:     1,
		}, output.Catalog))

		// The platform project homes the operator identities and their teams;
		// ownedProject is the protected resource. 052 §3 validates the foreign
		// principal's lifecycle state, so these are real user rows, not bare
		// membership edges.
		platformProject, schemaURL := ensureUserTestProject(t, d.stmts)
		ownedProject := ensureProject(t, d.stmts)

		acme := "team_acme_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(ctx, newTestTeam(platformProject, acme)))

		alice := "usr-alice-" + uniqueSuffix(t)
		bob := "usr-bob-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(ctx,
			newTestUser(t, platformProject, schemaURL, alice, alice+"@example.com", "Alice")))
		require.NoError(t, d.stmts.CreateUser(ctx,
			newTestUser(t, platformProject, schemaURL, bob, bob+"@example.com", "Bob")))

		// Both participate in Acme. Only Alice additionally owns it — the two
		// facts 053 §1 keeps separate.
		for _, u := range []string{alice, bob} {
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(ctx,
				domain.NewUserTeamMembershipEdge(platformProject, acme, u)))
		}
		require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, catalogAssignment(
			catalogID, platformProject,
			domain.AuthzPrincipalTypeUser, alice,
			"team", "owner", domain.NewTeamAssignmentScope(acme))))

		// Acme owns ownedProject. The second row co-locates the same relation
		// inside the platform project so control 2 can isolate cross-project
		// lookup as the only difference.
		for _, p := range []string{ownedProject, platformProject} {
			require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, catalogAssignment(
				catalogID, p,
				domain.AuthzPrincipalTypeTeam, acme,
				"project", "owning_team", domain.NewProjectAssignmentScope())))
		}

		check := func(t *testing.T, principal, projectID, relation string) bool {
			t.Helper()
			allowed, _, err := d.stmts.CheckAuthz(ctx, domain.AuthzCheckParams{
				CatalogID:              catalogID,
				ProjectID:              projectID,
				PrincipalHomeProjectID: platformProject,
				PrincipalType:          domain.AuthzPrincipalTypeUser,
				PrincipalID:            principal,
				ObjectType:             "project",
				Relation:               relation,
			})
			require.NoError(t, err)
			return allowed
		}

		// Control 1: the tuple-to-userset hop itself works across projects when
		// the source relation is `member` — writeFullTTUExists special-cases it
		// and resolves membership edges in the principal's home project.
		t.Run("control: member from owning_team resolves cross-project", func(t *testing.T) {
			assert.True(t, check(t, bob, ownedProject, "participant"),
				"the TTU member branch must expand the owning team's roster from the home project")
		})

		// Control 2: the same `owner from owning_team` rule resolves when the
		// owning_team row and the team.owner assignment share a project. This
		// proves the catalog, the team-scoped source assignment, and the
		// relation closure are all sound.
		t.Run("control: owner from owning_team resolves within one project", func(t *testing.T) {
			assert.True(t, check(t, alice, platformProject, "admin"),
				"owner-of-owning-team must resolve when both rows live in the same project")
		})

		// The other half of 053 §3, and obligation 15: participation alone
		// never inherits. This passes today and must keep passing — a fix that
		// resolved the case below by treating membership as ownership would
		// turn this red.
		t.Run("contributor does not inherit project admin", func(t *testing.T) {
			assert.False(t, check(t, bob, ownedProject, "admin"),
				"an active participant who is not an owner must not inherit project.admin")
			assert.False(t, check(t, bob, platformProject, "admin"),
				"...including when the owning_team row is co-located")
		})

		// The finding. Acme owns ownedProject and Alice owns Acme, so 053 §3
		// and obligations 1 and 5 make her administrator there.
		//
		// It does not resolve. writeFullTTUExists
		// (internal/storage/dialect/authz/resolver_sql.go) special-cases the
		// source relation `member` — control 1 — but constrains every other
		// source relation to an assignment on the *protected* project.
		// `team.owner` lives in the platform project, so the second hop finds
		// nothing: membership crosses projects, ownership does not.
		t.Run("owning-team owner inherits project admin", func(t *testing.T) {
			assert.True(t, check(t, alice, ownedProject, "admin"),
				"an owner of the owning team must inherit project.admin on the owned project "+
					"(ADR 053 §3; obligations 1 and 5)")
		})
	})
}

// catalogAssignment builds an assignment against an explicitly named catalog.
// newTestAssignment pins domain.SystemCatalogID, which does not define the
// target relations this file compiles.
func catalogAssignment(
	catalogID, projectID string,
	principalType domain.AuthzPrincipalType, principalID string,
	objectType, relation string,
	scope domain.AuthzAssignmentScope,
) *domain.AuthzAssignment {
	a := &domain.AuthzAssignment{
		ProjectID:     projectID,
		CatalogID:     catalogID,
		PrincipalType: principalType,
		PrincipalID:   principalID,
		ObjectType:    objectType,
		Relation:      relation,
	}
	a.ApplyScope(scope)
	return a
}
