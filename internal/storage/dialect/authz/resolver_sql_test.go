package authz_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

type recordingWriter struct {
	b    strings.Builder
	args []any
}

func (r *recordingWriter) WriteString(s string) { r.b.WriteString(s) }
func (r *recordingWriter) WriteArg(arg any) {
	r.args = append(r.args, arg)
	r.b.WriteString("?")
}

func testEnv(r *recordingWriter) authz.Env {
	return authz.Env{
		Schema: "zitadel_nextgen.",
		Now:    func(w authz.ArgWriter) { w.WriteString("NOW_SENTINEL") },
	}
}

func TestWriteCheckAndListShareFullTTU(t *testing.T) {
	t.Parallel()
	params := domain.AuthzCheckParams{
		CatalogID:     "cat_sys_1",
		ProjectID:     "proj_1",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_a",
		ObjectType:    "project",
		Relation:      "viewer",
	}

	var check recordingWriter
	authz.WriteCheckAuthz(&check, testEnv(&check), params)
	sql := check.b.String()
	require.Contains(t, sql, "tuple_to_userset")
	assert.Contains(t, sql, "a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id")
	assert.Contains(t, sql, "a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id")
	assert.Contains(t, sql, "ts.principal_type = edge.source_object_type")
	assert.Contains(t, sql, "NOW_SENTINEL")
	assert.Contains(t, sql, "zitadel_nextgen.authz_assignments")

	listParams := domain.AuthzListObjectsParams{
		AuthzCheckParams: params,
		ResourceKind:     domain.ResourceKindUser,
	}
	var list recordingWriter
	authz.WriteListAuthzObjectIDs(&list, testEnv(&list), listParams)
	listSQL := list.b.String()
	require.Contains(t, listSQL, "tuple_to_userset")
	assert.Contains(t, listSQL, "a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id")
	assert.Contains(t, listSQL, "a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id")
	assert.Contains(t, listSQL, "ts.principal_type = edge.source_object_type")
	assert.Contains(t, listSQL, "NOW_SENTINEL")

	var exists recordingWriter
	authz.WriteListAuthzExistsPredicate(&exists, testEnv(&exists), "zitadel_nextgen.users.id", listParams)
	existsSQL := exists.b.String()
	require.Contains(t, existsSQL, "EXISTS (")
	assert.Contains(t, existsSQL, "r.resource_id = zitadel_nextgen.users.id")
	assert.Contains(t, existsSQL, "tuple_to_userset")
	assert.Contains(t, existsSQL, "a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id")
	assert.Contains(t, existsSQL, "a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id")
}

func TestWriteCheckAuthzBindOrder(t *testing.T) {
	t.Parallel()
	params := domain.AuthzCheckParams{
		CatalogID:              "cat_sys_1",
		ProjectID:              "proj_1",
		PrincipalHomeProjectID: "proj_home",
		PrincipalType:          domain.AuthzPrincipalTypeUser,
		PrincipalID:            "user_a",
		ObjectType:             "project",
		Relation:               "viewer",
	}
	var w recordingWriter
	authz.WriteCheckAuthz(&w, testEnv(&w), params)
	require.NotEmpty(t, w.args)
	assert.Equal(t, "project", w.args[0])
	assert.Equal(t, "viewer", w.args[1])
	assert.Equal(t, "proj_1", w.args[2])
	assert.Equal(t, "cat_sys_1", w.args[3])
	assert.Contains(t, w.args, "user_a")
	assert.Contains(t, w.args, "proj_home")
	assert.Contains(t, w.args, domain.AuthzPrincipalTypeUser.String())
}

func TestWriteActiveSystemCatalogID(t *testing.T) {
	t.Parallel()
	var w recordingWriter
	authz.WriteActiveSystemCatalogID(&w, testEnv(&w))
	assert.Equal(t, []any{
		domain.AuthzCatalogKindSystem.String(),
		domain.SystemCatalogOwnerID,
		domain.AuthzCatalogStatusActive.String(),
	}, w.args)
	assert.Contains(t, w.b.String(), "zitadel_nextgen.authz_catalogs")
}

func TestWriteCheckAuthzScopedGrantArms(t *testing.T) {
	t.Parallel()
	params := domain.AuthzCheckParams{
		CatalogID:      "cat_sys_1",
		ProjectID:      "proj_1",
		PrincipalType:  domain.AuthzPrincipalTypeUser,
		PrincipalID:    "user_a",
		ObjectType:     "project",
		Relation:       "viewer",
		ResourceID:     "usr_1",
		ResourceTeamID: "team_1",
	}
	var w recordingWriter
	authz.WriteCheckAuthz(&w, testEnv(&w), params)
	assert.Contains(t, w.b.String(), "a.scope_kind = 'team' AND a.scope_team_id = ?")
	assert.Contains(t, w.b.String(), "a.scope_kind = 'resource' AND a.scope_resource_id = ?")
	assert.Contains(t, w.args, "team_1")
	assert.Contains(t, w.args, "usr_1")
}

func TestWriteCheckAuthzConstraintTeam(t *testing.T) {
	t.Parallel()
	params := domain.AuthzCheckParams{
		CatalogID:        "cat_sys_1",
		ProjectID:        "proj_1",
		PrincipalType:    domain.AuthzPrincipalTypeSKTeam,
		PrincipalID:      "sk_team_1",
		ObjectType:       "project",
		Relation:         "viewer",
		ConstraintTeamID: "team_1",
		ResourceID:       "usr_in",
	}
	var w recordingWriter
	authz.WriteCheckAuthz(&w, testEnv(&w), params)
	assert.Contains(t, w.b.String(), "authz_membership_edges")
	assert.Contains(t, w.args, "team_1")
	assert.Contains(t, w.args, "usr_in")

	listParams := domain.AuthzListObjectsParams{
		AuthzCheckParams: params,
		ResourceKind:     domain.ResourceKindUser,
	}
	var list recordingWriter
	authz.WriteListAuthzObjectIDs(&list, testEnv(&list), listParams)
	assert.Contains(t, list.b.String(), "authz_membership_edges")
	assert.Contains(t, list.b.String(), "r.resource_kind = ?")
	assert.Contains(t, list.b.String(), "r.resource_kind <> ?")
	assert.Contains(t, list.args, "team_1")

	withTeam := params
	withTeam.ResourceTeamID = "team_1"
	var checkTeam recordingWriter
	authz.WriteCheckAuthz(&checkTeam, testEnv(&checkTeam), withTeam)
	assert.Contains(t, checkTeam.b.String(), "authz_membership_edges")
	assert.Contains(t, checkTeam.args, "team_1")
}

func TestWriteHasAuthzProjectFoothold(t *testing.T) {
	t.Parallel()
	var w recordingWriter
	authz.WriteHasAuthzProjectFoothold(&w, testEnv(&w), "proj_1", domain.AuthzPrincipalTypeUser, "user_a")
	assert.Contains(t, w.b.String(), "NOW_SENTINEL")
	assert.Contains(t, w.args, "proj_1")
	assert.Contains(t, w.args, "user_a")
}

// TestListPredicateLiftsConstantArms pins the shape, because nothing else does.
// The project-scoped and TTU arms cannot reference the correlated RSI row, so
// inside the EXISTS they are a query-constant that Spanner's emulator
// re-evaluates once per listed row: 18.6s of a 22.7s query over ten rows. If a
// later refactor folds them back inside, every behavioural suite stays green and
// only the timings move, which is exactly the regression that went unnoticed
// from #811 until #972.
func TestListPredicateLiftsConstantArms(t *testing.T) {
	t.Parallel()
	var w recordingWriter
	authz.WriteListAuthzExistsPredicate(&w, testEnv(&w), "zitadel_nextgen.teams.id",
		domain.AuthzListObjectsParams{
			AuthzCheckParams: domain.AuthzCheckParams{
				CatalogID:     "cat_sys_1",
				ProjectID:     "proj_1",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_a",
				ObjectType:    "project",
				Relation:      "viewer",
			},
			ResourceKind: domain.ResourceKindTeam,
		})
	sql := w.b.String()

	// The correlated subquery is the first mention of the RSI alias, so the
	// lifted arms must appear before it.
	firstRSI := strings.Index(sql, "resource_scope_index r")
	require.NotEqual(t, -1, firstRSI, "predicate must query resource_scope_index")

	// Assert on the LAST occurrence, not the first. `a.scope_kind = 'project'`
	// is emitted twice — once by the direct project-scoped arm and once inside
	// writeFullTTUExists' own project-scope case — so checking the first match
	// would still pass if the direct arm were folded back into the correlated
	// subquery while the TTU arm stayed lifted. Requiring the last occurrence to
	// precede the subquery pins every project-scope arm at once.
	require.Contains(t, sql, "a.scope_kind = 'project'", "project-scoped arm must be emitted")
	assert.Less(t, strings.LastIndex(sql, "a.scope_kind = 'project'"), firstRSI,
		"every project-scoped arm must be lifted out of the correlated EXISTS")

	require.Contains(t, sql, "tuple_to_userset", "tuple-to-userset arm must be emitted")
	assert.Less(t, strings.LastIndex(sql, "tuple_to_userset"), firstRSI,
		"tuple-to-userset arm must be lifted out of the correlated EXISTS")

	// The lift is only sound because the constant arms are ANDed with an RSI
	// existence check: an object with no RSI row must stay invisible even when
	// they are true, so a bare `constant OR EXISTS(...)` would expose rows that
	// were never registered.
	assert.Equal(t, 2, strings.Count(sql, "resource_scope_index r"),
		"both halves of the lifted predicate must require an RSI row")

	// Counting the subqueries is not enough on its own: flipping that AND to an
	// OR leaves the count and every other assertion above unchanged while
	// reintroducing exactly that leak. So pin the connector that joins the
	// constant group to the first RSI subquery.
	head := sql[:firstRSI]
	openingExists := strings.LastIndex(head, "EXISTS (")
	require.NotEqual(t, -1, openingExists, "the first RSI subquery must be an EXISTS")
	assert.True(t, strings.HasSuffix(strings.TrimSpace(head[:openingExists]), "AND"),
		"the constant arms must be ANDed with the RSI existence check, not ORed: "+
			"an OR would make objects with no RSI row visible to any project-wide grant")

	// The arms that genuinely depend on the row must stay inside, correlated.
	assert.Contains(t, sql, "a.scope_team_id = r.team_id")
	assert.Contains(t, sql, "a.scope_resource_id = r.resource_id")
}
