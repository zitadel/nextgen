package postgres

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/idpconnection"
)

// The connection list is the first read to pass compileList an alias rather
// than a table name, because its FROM clause aliases the table as `c` and an
// alias hides the name it stands for. A predicate naming the table would be
// rejected by the database, and no list test reaches this branch: they all run
// unrestricted, which writes no predicate at all.
func TestCompileListIDPConnectionsNamesTheJoinAlias(t *testing.T) {
	t.Parallel()

	ctx := service.WithAuthzListFilter(context.Background(), service.AuthzListFilter{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID: domain.SystemCatalogID, ProjectID: "proj_1", PrincipalHomeProjectID: "proj_1",
			PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_1",
			ObjectType: "project", Relation: "viewer",
		},
		ResourceKind: domain.ResourceKindIDPConnection,
	})

	opts := idpconnection.EnsureListOptions(&database.ListOptions[domain.IDPConnectionField]{
		Filter: database.Equal(database.Col(domain.IDPConnectionFieldProjectID), "proj_1"),
	})

	var compiler statementCompiler
	require.NoError(t, compileList(ctx, &compiler, idpConnectionQuery, opts, idpconnection.Schema, "c", "id"))

	sql := compiler.String()
	assert.Contains(t, sql, "c.id")
	assert.NotContains(t, sql, "zitadel_nextgen.idp_connections.id")
	assert.Contains(t, sql, "ORDER BY c.created_at, c.id")
}
