package authz_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestWriteAuthorizedProjectIDs(t *testing.T) {
	t.Parallel()
	var w recordingWriter
	authz.WriteAuthorizedProjectIDs(&w, testEnv(&w), "proj_platform", "user_a")
	sql := w.b.String()

	assert.Contains(t, sql, "zitadel_nextgen.authz_assignments")
	assert.Contains(t, sql, "a.object_type = 'project'")
	assert.Contains(t, sql, "a.scope_kind = 'project'")
	assert.Contains(t, sql, "a.revoked_at IS NULL")
	assert.Contains(t, sql, "NOW_SENTINEL")
	// The catalog pin: only the active system catalog counts, or an app-group
	// grant would surface a project CheckAuthz refuses to authorize.
	assert.Contains(t, sql, "a.catalog_id = (")
	assert.Contains(t, sql, "catalog_kind = ")
	assert.Contains(t, sql, "zitadel_nextgen.authz_catalogs")
	// The team arm expands membership through the edge table.
	assert.Contains(t, sql, "a.principal_type = 'team'")
	assert.Contains(t, sql, "a.principal_id IN (")
	assert.Contains(t, sql, "zitadel_nextgen.authz_membership_edges")
	assert.Contains(t, sql, "e.set_type = 'team'")

	// Third arm: the bounded tuple-to-userset path, catalog driven.
	assert.Contains(t, sql, "zitadel_nextgen.authz_expression_edges")
	assert.Contains(t, sql, "zitadel_nextgen.authz_relation_closure")
	assert.Contains(t, sql, "edge.kind               = 'tuple_to_userset'")
	assert.Contains(t, sql, "edge.object_type        = 'project'")
	assert.Contains(t, sql, "SELECT ts.project_id")

	catalogArgs := []any{
		domain.AuthzCatalogKindSystem.String(),
		domain.SystemCatalogOwnerID,
		domain.AuthzCatalogStatusActive.String(),
	}
	user := domain.AuthzPrincipalTypeUser.String()
	want := append([]any{}, catalogArgs...)
	want = append(want, user, "user_a")
	want = append(want, catalogArgs...)
	want = append(want, "proj_platform", "user_a")
	want = append(want, catalogArgs...)
	want = append(want, user, "user_a", "proj_platform", "user_a")
	assert.Equal(t, want, w.args)
	assert.Contains(t, w.args, "system", "the catalog pin must bind the system kind")
}

// The whole point of the round-2 rework: discovery must not grow a second
// principal-matching rule. Both arms come out of the emitters CheckAuthz uses,
// so the fragments they produce have to appear in CheckAuthz's SQL too.
func TestWriteAuthorizedProjectIDsSharesCheckAuthzEmitters(t *testing.T) {
	t.Parallel()
	var discovery recordingWriter
	authz.WriteAuthorizedProjectIDs(&discovery, testEnv(&discovery), "proj_platform", "user_a")

	var check recordingWriter
	authz.WriteCheckAuthz(&check, testEnv(&check), domain.AuthzCheckParams{
		CatalogID:              "cat_sys_1",
		ProjectID:              "proj_customer",
		PrincipalHomeProjectID: "proj_platform",
		PrincipalType:          domain.AuthzPrincipalTypeUser,
		PrincipalID:            "user_a",
		ObjectType:             "project",
		Relation:               "viewer",
	})
	checkSQL := check.b.String()

	for _, fragment := range []string{
		// writeDirectPrincipal
		"a.principal_type = ? AND a.principal_id = ?",
		// writeMembershipEdgeMatch: the home-project rule lives here, so both
		// paths have to read it from the same emitter.
		"e.project_id = ?\n          AND e.set_type = 'team'",
		"AND e.member_type = 'user'\n          AND e.member_id = ?",
		// writeTTUScopeMatch: which tupleset row an assignment may borrow from.
		"(a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id)",
		"(a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id)",
		"(a.scope_kind = 'project' AND a.object_type = edge.source_object_type)",
	} {
		assert.Contains(t, discovery.b.String(), fragment)
		assert.Contains(t, checkSQL, fragment,
			"discovery and CheckAuthz must emit this from the same writer")
	}

	// Only discovery spells membership as IN: it has no outer row to correlate
	// to. CheckAuthz keeps the correlated EXISTS the Spanner lane has proven.
	assert.Contains(t, discovery.b.String(), "a.principal_id IN (")
	assert.Contains(t, checkSQL, "EXISTS (\n        SELECT 1\n        FROM zitadel_nextgen.authz_membership_edges e")
}

// ADR 053 §6 rules out scanning projects and checking each row, so the subquery
// must stand on its own: no reference to an outer project column.
func TestWriteAuthorizedProjectIDsIsNotCorrelated(t *testing.T) {
	t.Parallel()
	var w recordingWriter
	authz.WriteAuthorizedProjectIDs(&w, testEnv(&w), "proj_platform", "user_a")
	sql := w.b.String()

	require.Equal(t, 2, strings.Count(sql, "SELECT a.project_id"), "both principal arms must select project ids")
	require.Equal(t, 1, strings.Count(sql, "SELECT ts.project_id"), "the tuple-to-userset arm must select the tupleset row's project")
	assert.Equal(t, 2, strings.Count(sql, "\nUNION ALL\n"), "three arms are joined by two UNION ALL")
	assert.Contains(t, sql, "UNION ALL",
		"SQLite rejects UNION DISTINCT and Spanner rejects a bare UNION")
	// ts.project_id = a.project_id joins the two assignment rows to each other,
	// not to an outer projects row, so it is not a correlation.
	assert.NotContains(t, sql, "a.project_id = ?",
		"a bound project id would correlate the subquery to an outer row")
	for _, outer := range []string{"projects.id", "p.id", "zitadel_nextgen.projects.id"} {
		assert.NotContains(t, sql, outer,
			"the subquery must not reference the outer projects row")
	}
}

// Discovery and CheckAuthz must agree on who a grant belongs to: the edge lookup
// has to read the home project, not the project being listed.
func TestWriteAuthorizedProjectIDsBindsHomeProject(t *testing.T) {
	t.Parallel()
	var w recordingWriter
	authz.WriteAuthorizedProjectIDs(&w, testEnv(&w), "proj_platform", "user_a")
	assert.Equal(t, "proj_platform",
		bindAtFragment(t, w.b.String(), w.args, "e.project_id = ?"))
}
