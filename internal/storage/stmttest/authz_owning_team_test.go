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

// ADR 053 §3's profile fragment, minus `sk_proj` (irrelevant to the path under
// test). `admin` derives from the *owner* relation of the owning team, while
// the lower roles derive from `team#member` — the asymmetry this file probes.
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
`

// TestAuthzOwningTeamOwnerInheritsProjectAdmin pins the load-bearing rule of
// [ADR 053] §3 — "team owners inherit; contributors do not" — against the
// portable resolver.
//
// The shape under test is the one ADR 052 and 053 jointly specify:
//
//   - `project.owning_team` is stored on the **protected** (customer) project
//     and names a foreign platform team (ADR 053 §2);
//   - `team.owner` is stored at the team's **home** (platform) scope, as a
//     distinct assignment from roster membership (ADR 053 §1);
//   - the human is homed in the platform project and holds nothing at all in
//     the customer project (ADR 052 §1).
//
// The two control subtests establish that the harness, catalog, and
// cross-project machinery are sound, so a failure in the third isolates the
// tuple-to-userset hop rather than the setup.
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

		// The platform project homes the operator identity and its teams; the
		// customer projects are the protected resources.
		platformProject := ensureProject(t, d.stmts)
		grantedProject := ensureProject(t, d.stmts)
		ownedProject := ensureProject(t, d.stmts)

		acme := "team_acme_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(ctx, newTestTeam(platformProject, acme)))

		// Alice is an active participant of Acme and, separately, its owner —
		// the two facts ADR 053 §1 keeps distinct.
		alice := "user_alice_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(ctx,
			domain.NewUserTeamMembershipEdge(platformProject, acme, alice)))
		require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, catalogAssignment(
			catalogID, platformProject,
			domain.AuthzPrincipalTypeUser, alice,
			"team", "owner", domain.NewTeamAssignmentScope(acme))))

		check := func(t *testing.T, projectID, relation string) (bool, bool) {
			t.Helper()
			allowed, foothold, err := d.stmts.CheckAuthz(ctx, domain.AuthzCheckParams{
				CatalogID:              catalogID,
				ProjectID:              projectID,
				PrincipalHomeProjectID: platformProject,
				PrincipalType:          domain.AuthzPrincipalTypeUser,
				PrincipalID:            alice,
				ObjectType:             "project",
				Relation:               relation,
			})
			require.NoError(t, err)
			return allowed, foothold
		}

		// Control 1: the identical `owner from owning_team` rule, evaluated
		// with the owning_team row and the team.owner assignment in the *same*
		// project. This is the finding's controlled twin — it differs in
		// exactly one variable, whether the two rows are co-located — so it
		// proves the catalog, the team-scoped source assignment, and the
		// relation closure are all sound.
		t.Run("control: owner from owning_team resolves within one project", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, catalogAssignment(
				catalogID, platformProject,
				domain.AuthzPrincipalTypeTeam, acme,
				"project", "owning_team", domain.NewProjectAssignmentScope())))

			allowed, _, err := d.stmts.CheckAuthz(ctx, domain.AuthzCheckParams{
				CatalogID:     catalogID,
				ProjectID:     platformProject,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   alice,
				ObjectType:    "project",
				Relation:      "admin",
			})
			require.NoError(t, err)
			assert.True(t, allowed,
				"owner-of-owning-team must resolve when both rows live in the same project")
		})

		// Control 2: a foreign *team* grant expands membership from the home
		// project — ADR 052 testing obligation 2. This is the resolver's
		// hardcoded `team#member` fast path, and it proves cross-project
		// resolution works in general.
		t.Run("control: cross-project team grant expands from home", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, catalogAssignment(
				catalogID, grantedProject,
				domain.AuthzPrincipalTypeTeam, acme,
				"project", "admin", domain.NewProjectAssignmentScope())))

			allowed, _ := check(t, grantedProject, "admin")
			assert.True(t, allowed,
				"a foreign team grant must expand active membership from the principal's home project")
		})

		// The finding. Acme owns `ownedProject`; Alice owns Acme. ADR 053 §3
		// says that makes her administrator there, and testing obligations 1
		// and 5 require it.
		//
		// It does not resolve. `writeFullTTUExists` in
		// internal/storage/dialect/authz/resolver_sql.go special-cases the
		// source relation `member` (looking up membership edges in the
		// principal's home project) but constrains every other source relation
		// to an assignment on the *protected* project. `team.owner` lives in
		// the platform project, so the second hop finds nothing: membership
		// crosses projects, ownership does not.
		t.Run("owning-team owner inherits project admin", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, catalogAssignment(
				catalogID, ownedProject,
				domain.AuthzPrincipalTypeTeam, acme,
				"project", "owning_team", domain.NewProjectAssignmentScope())))

			allowed, foothold := check(t, ownedProject, "admin")
			assert.True(t, allowed,
				"an owner of the owning team must inherit project.admin on the owned project "+
					"(ADR 053 §3; obligations 1 and 5). foothold=%v", foothold)
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
