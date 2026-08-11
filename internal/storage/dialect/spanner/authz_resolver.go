package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

var (
	spAuthz                     = authz.SpannerSQL()
	activeSystemCatalogIDStmt   = spAuthz.ActiveSystemCatalogID()
	hasAuthzProjectFootholdStmt = spAuthz.HasAuthzProjectFoothold()
	checkAuthzStmt              = spAuthz.CheckAuthz()
	listAuthzObjectIDsStmt      = spAuthz.ListAuthzObjectIDs()
)

type authzResolverStatements struct{ statement }

func newAuthzResolverStatements(db queryExecutor) authzResolverStatements {
	return authzResolverStatements{statement: statement{db: db}}
}

// ActiveSystemCatalogID implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ActiveSystemCatalogID(ctx context.Context) (string, error) {
	var id string
	err := s.db.Query(ctx, buildStatement(activeSystemCatalogIDStmt,
		domain.AuthzCatalogKindSystem.String(),
		domain.SystemCatalogOwnerID,
		domain.AuthzCatalogStatusActive.String(),
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		id, qErr = collectOneRow(iter, func(row *spanner.Row) (string, error) {
			var v string
			return v, row.Columns(&v)
		})
		return qErr
	})
	if err != nil {
		return "", wrapError(err)
	}
	return id, nil
}

// HasAuthzProjectFoothold implements [service.AuthzResolverStatements].
func (s authzResolverStatements) HasAuthzProjectFoothold(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error) {
	var ok bool
	err := s.db.Query(ctx, buildStatement(hasAuthzProjectFootholdStmt,
		projectID, principalType.String(), principalID,
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		ok, qErr = collectOneRow(iter, func(row *spanner.Row) (bool, error) {
			var found bool
			return found, row.Columns(&found)
		})
		return qErr
	})
	if err != nil {
		return false, wrapError(err)
	}
	return ok, nil
}

// CheckAuthz implements [service.AuthzResolverStatements].
func (s authzResolverStatements) CheckAuthz(ctx context.Context, params domain.AuthzCheckParams) (bool, bool, error) {
	type outcome struct{ allowed, foothold bool }
	var out outcome
	err := s.db.Query(ctx, buildStatement(checkAuthzStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		params.HomeProjectID(),
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		out, qErr = collectOneRow(iter, func(row *spanner.Row) (outcome, error) {
			var o outcome
			return o, row.Columns(&o.allowed, &o.foothold)
		})
		return qErr
	})
	if err != nil {
		return false, false, wrapError(err)
	}
	return out.allowed, out.foothold, nil
}

// ListAuthzObjectIDs implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ListAuthzObjectIDs(ctx context.Context, params domain.AuthzListObjectsParams) ([]string, error) {
	var ids []string
	err := s.db.Query(ctx, buildStatement(listAuthzObjectIDsStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		params.HomeProjectID(),
		params.ResourceKind.String(),
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		ids, qErr = collectRows(iter, func(row *spanner.Row) (string, error) {
			var id string
			return id, row.Columns(&id)
		})
		return qErr
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

var _ service.AuthzResolverStatements = (*authzResolverStatements)(nil)
