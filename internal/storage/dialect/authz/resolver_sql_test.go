package authz_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestSQLStyle_CheckAndListShareFullTTU(t *testing.T) {
	t.Parallel()
	for _, style := range []authz.SQLStyle{
		authz.PostgresSQL(),
		authz.SpannerSQL(),
		authz.SQLiteSQL(8),
	} {
		check := style.CheckAuthz()
		list := style.ListAuthzObjectIDs()
		require.Contains(t, check, "tuple_to_userset")
		require.Contains(t, list, "tuple_to_userset")
		// Check returns (allowed, foothold) in one SELECT.
		assert.Contains(t, check, "authz_membership_edges")
		assert.True(t, strings.Count(check, "SELECT") >= 1)
		// List must include the general scoped-TTU branch, not only team.member membership.
		assert.Contains(t, list, "a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id")
		assert.Contains(t, list, "a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id")
	}
}

func TestSQLStyle_DialectPlaceholders(t *testing.T) {
	t.Parallel()
	pg := authz.PostgresSQL().ActiveSystemCatalogID()
	assert.Contains(t, pg, "zitadel_nextgen.authz_catalogs")
	assert.Contains(t, pg, "$1")

	sp := authz.SpannerSQL().ActiveSystemCatalogID()
	assert.NotContains(t, sp, "zitadel_nextgen.")
	assert.Contains(t, sp, "@p1")

	sq := authz.SQLiteSQL(4).HasAuthzProjectFoothold()
	assert.Contains(t, sq, "?4")
	assert.NotContains(t, sq, "zitadel_nextgen.")
}
