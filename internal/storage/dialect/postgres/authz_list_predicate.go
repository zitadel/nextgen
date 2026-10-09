package postgres

import (
	"context"

	"github.com/zitadel/zitadel/v5/internal/service"
	"github.com/zitadel/zitadel/v5/internal/storage/dialect/authz"
)

// maybeWriteAuthzListPredicate appends the shared EXISTS list conjunct when a
// filter is on the context (attached by requireProjectListAccess on Forbidden).
func maybeWriteAuthzListPredicate(ctx context.Context, c *statementCompiler, hasWhere *bool, tableAliasOrName, resourceIDCol string) {
	f, ok := service.AuthzListFilterFromContext(ctx)
	if !ok {
		return
	}
	writeConjunct(c, hasWhere)
	authz.WriteListAuthzExistsPredicate(c, postgresAuthzEnv(), tableAliasOrName+"."+resourceIDCol, f)
}
