package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func spannerAuthzEnv() authz.Env {
	return authz.Env{
		Now: func(w authz.ArgWriter) { w.WriteString("CURRENT_TIMESTAMP()") },
	}
}

type authzResolverStatements struct{ statement }

func newAuthzResolverStatements(db queryExecutor) authzResolverStatements {
	return authzResolverStatements{statement: statement{db: db}}
}

// ActiveSystemCatalogID implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ActiveSystemCatalogID(ctx context.Context) (string, error) {
	var c statementCompiler
	authz.WriteActiveSystemCatalogID(&c, spannerAuthzEnv())
	var id string
	err := s.db.Query(ctx, c.statement(), func(iter *spanner.RowIterator) error {
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
func (s authzResolverStatements) HasAuthzProjectFoothold(ctx context.Context, projectID, homeProjectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error) {
	var c statementCompiler
	authz.WriteHasAuthzProjectFoothold(&c, spannerAuthzEnv(), projectID, homeProjectID, principalType, principalID)
	var ok bool
	err := s.db.Query(ctx, c.statement(), func(iter *spanner.RowIterator) error {
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
	var c statementCompiler
	authz.WriteCheckAuthz(&c, spannerAuthzEnv(), params)
	type outcome struct{ allowed, foothold bool }
	var out outcome
	err := s.db.Query(ctx, c.statement(), func(iter *spanner.RowIterator) error {
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

// checkAuthzProjectsPerStatement is how many projects one statement of
// CheckAuthzProjects decides. Spanner refuses a query with more than 20 joins
// (https://cloud.google.com/spanner/quotas#query-limits), and the check
// writes four for each project, so the ten projects of one search were 40.
// Four projects are 16.
const checkAuthzProjectsPerStatement = 4

// CheckAuthzProjects implements [service.AuthzResolverStatements], in
// statements of checkAuthzProjectsPerStatement projects each.
func (s authzResolverStatements) CheckAuthzProjects(ctx context.Context, params domain.AuthzCheckParams, projectIDs []string) ([]domain.AuthzCheckResult, error) {
	results := make([]domain.AuthzCheckResult, len(projectIDs))
	for first := 0; first < len(projectIDs); first += checkAuthzProjectsPerStatement {
		chunk := projectIDs[first:min(first+checkAuthzProjectsPerStatement, len(projectIDs))]
		var c statementCompiler
		authz.WriteCheckAuthzProjects(&c, spannerAuthzEnv(), params, chunk)
		err := s.db.Query(ctx, c.statement(), func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				// The project's place in this statement.
				var arm int64
				var result domain.AuthzCheckResult
				if err := row.Columns(&arm, &result.Allowed, &result.Foothold); err != nil {
					return err
				}
				results[first+int(arm)] = result
				return nil
			})
		})
		if err != nil {
			return nil, wrapError(err)
		}
	}
	return results, nil
}

// CheckPlatformOperator implements [service.AuthzResolverStatements].
func (s authzResolverStatements) CheckPlatformOperator(ctx context.Context, params domain.AuthzPlatformCheckParams) (bool, error) {
	var c statementCompiler
	authz.WriteCheckPlatformOperator(&c, spannerAuthzEnv(), params)
	var ok bool
	err := s.db.Query(ctx, c.statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		ok, qErr = collectOneRow(iter, func(row *spanner.Row) (bool, error) {
			var allowed bool
			return allowed, row.Columns(&allowed)
		})
		return qErr
	})
	if err != nil {
		return false, wrapError(err)
	}
	return ok, nil
}

// ListAuthzObjectIDs implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ListAuthzObjectIDs(ctx context.Context, params domain.AuthzListObjectsParams) ([]string, error) {
	var c statementCompiler
	authz.WriteListAuthzObjectIDs(&c, spannerAuthzEnv(), params)
	var ids []string
	err := s.db.Query(ctx, c.statement(), func(iter *spanner.RowIterator) error {
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
