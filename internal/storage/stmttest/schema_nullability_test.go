//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	"github.com/zitadel/nextgen/internal/storage/dialect/schematest"
	"github.com/zitadel/nextgen/internal/storage/environment"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
	"github.com/zitadel/nextgen/internal/storage/release"
	"github.com/zitadel/nextgen/internal/storage/teammembership"
	"github.com/zitadel/nextgen/internal/storage/user"
	"github.com/zitadel/nextgen/internal/storage/userpasskey"
	"github.com/zitadel/nextgen/internal/storage/userpassword"
	"github.com/zitadel/nextgen/internal/storage/userrecoverycodes"
	"github.com/zitadel/nextgen/internal/storage/userteam"
	"github.com/zitadel/nextgen/internal/storage/usertotp"
	"github.com/zitadel/nextgen/internal/storage/variable"
)

func sharedSchemaColumns(t *testing.T) []schematest.ColumnNullability {
	t.Helper()
	var cols []schematest.ColumnNullability
	cols = append(cols, schematest.Columns("users", user.Schema)...)
	cols = append(cols, schematest.Columns("user_passkeys", userpasskey.Schema)...)
	cols = append(cols, schematest.Columns("user_passwords", userpassword.Schema)...)
	cols = append(cols, schematest.Columns("user_recovery_codes", userrecoverycodes.Schema)...)
	cols = append(cols, schematest.Columns("user_totp", usertotp.Schema)...)
	cols = append(cols, schematest.Columns("team_memberships", teammembership.Schema)...)
	cols = append(cols, schematest.Columns("branding", branding.Schema)...)
	cols = append(cols, schematest.Columns("environments", environment.Schema)...)
	cols = append(cols, schematest.Columns("releases", release.Schema)...)
	cols = append(cols, schematest.Columns("variables", variable.Schema)...)
	cols = append(cols, schematest.Columns("flow_definitions", flowdefinition.Schema)...)
	cols = append(cols, schematest.Columns("authz_membership_edges", authz.MembershipEdgeSchema)...)
	joined, err := schematest.JoinColumns(map[string]string{"m": "team_memberships", "t": "teams"}, userteam.Schema)
	require.NoError(t, err)
	return append(cols, joined...)
}

// A nullable column whose binding misses the Nullable flag silently drops its
// NULL rows once it becomes a sort column (#766), so every bound column's flag
// must match the DDL the dialect actually runs against.
func TestSchemaNullabilityMatchesDDL(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		live, err := d.liveNullability(t.Context())
		require.NoError(t, err)
		for _, col := range append(d.schemaNullability, sharedSchemaColumns(t)...) {
			columns, ok := live[col.Table]
			if !assert.True(t, ok, "table %s missing from live schema", col.Table) {
				continue
			}
			nullable, ok := columns[col.Column]
			if !assert.True(t, ok, "column %s.%s missing from live schema", col.Table, col.Column) {
				continue
			}
			assert.Equal(t, col.Nullable, nullable, "%s.%s: Nullable flag vs DDL", col.Table, col.Column)
		}
	})
}
