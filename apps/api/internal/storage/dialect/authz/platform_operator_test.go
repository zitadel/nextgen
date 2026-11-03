package authz_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestWriteCheckPlatformOperator(t *testing.T) {
	t.Parallel()
	var w recordingWriter
	authz.WriteCheckPlatformOperator(&w, testEnv(&w), domain.AuthzPlatformCheckParams{
		CatalogID:         "cat_sys_1",
		PlatformProjectID: "proj_platform",
		UserID:            "user_op",
		ObjectType:        "project",
		Relation:          "viewer",
	})
	sql := w.b.String()

	require.True(t, strings.HasPrefix(sql, "SELECT EXISTS ("))
	// The tupleset is implied: the edge is matched, no tupleset row is joined.
	assert.Contains(t, sql, "edge.tupleset_object_type = edge.object_type")
	assert.NotContains(t, sql, " ts\n")
	// The user holds it directly, in the platform project, and is active there.
	assert.Contains(t, sql, "a.principal_type = ? AND a.principal_id = ?")
	assert.Contains(t, sql, "zitadel_nextgen.users u")
	assert.Contains(t, sql, "NOW_SENTINEL")
	assert.NotContains(t, sql, "authz_membership_edges", "team membership must never confer the operator relation")

	assert.Equal(t, []any{
		"project", "viewer", // the relation checked
		"cat_sys_1",
		domain.AuthzTuplesetPlatform, domain.AuthzObjectTypePlatform,
		"proj_platform", // the assignment's project
		domain.AuthzPrincipalTypeUser.String(), "user_op",
		"proj_platform", "user_op", domain.UserStatusActive.String(), // the user's status
	}, w.args)
}

func TestListPredicateAddsPlatformOperatorArm(t *testing.T) {
	t.Parallel()
	params := domain.AuthzListObjectsParams{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID:              "cat_sys_1",
			ProjectID:              "proj_customer",
			PrincipalHomeProjectID: "proj_platform",
			PrincipalType:          domain.AuthzPrincipalTypeUser,
			PrincipalID:            "user_op",
			ObjectType:             "project",
			Relation:               "viewer",
		},
		ResourceKind: domain.ResourceKindUser,
	}
	write := func(p domain.AuthzListObjectsParams) string {
		var w recordingWriter
		authz.WriteListAuthzExistsPredicate(&w, testEnv(&w), "zitadel_nextgen.users.id", p)
		return w.b.String()
	}

	assert.NotContains(t, write(params), "zitadel_nextgen.users u", "no platform project, no operator arm")

	params.PlatformProjectID = "proj_platform"
	withArm := write(params)
	require.Contains(t, withArm, "zitadel_nextgen.users u")
	// The arm is a constant one: it sits before the row-correlated EXISTS.
	assert.Less(t, strings.Index(withArm, "zitadel_nextgen.users u"), strings.Index(withArm, "r.resource_id = zitadel_nextgen.users.id"))

	params.PrincipalHomeProjectID = "proj_customer"
	assert.NotContains(t, write(params), "zitadel_nextgen.users u", "a user homed elsewhere gets no operator arm")
}
