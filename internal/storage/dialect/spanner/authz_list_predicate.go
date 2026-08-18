package spanner

import (
	"context"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

// maybeWriteAuthzListPredicate appends the shared EXISTS list conjunct when a
// filter is on the context (after requireProjectListAccess + withAuthzListFilter).
func maybeWriteAuthzListPredicate(ctx context.Context, c *statementCompiler, hasWhere *bool, tableAliasOrName, resourceIDCol string) {
	f, ok := service.AuthzListFilterFromContext(ctx)
	if !ok {
		return
	}
	writeConjunct(c, hasWhere)
	authz.WriteListAuthzExistsPredicate(c, spannerAuthzEnv(), tableAliasOrName+"."+resourceIDCol, f)
}
