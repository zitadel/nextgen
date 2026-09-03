package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func sqliteAuthzEnv() authz.Env {
	return authz.Env{
		Now: func(w authz.ArgWriter) { w.WriteArg(nowUnixNano()) },
	}
}

type authzResolverStatements struct{ statement }

func newAuthzResolverStatements(client queryExecutor) authzResolverStatements {
	return authzResolverStatements{statement: statement{client: client}}
}

// ActiveSystemCatalogID implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ActiveSystemCatalogID(ctx context.Context) (string, error) {
	var c statementCompiler
	authz.WriteActiveSystemCatalogID(&c, sqliteAuthzEnv())
	var id string
	err := s.client.QueryRow(ctx, c.String(), c.args...).Scan(&id)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", database.NewNoRowFoundError(nil)
		}
		return "", wrapError(err)
	}
	return id, nil
}

// HasAuthzProjectFoothold implements [service.AuthzResolverStatements].
func (s authzResolverStatements) HasAuthzProjectFoothold(ctx context.Context, projectID, homeProjectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error) {
	var c statementCompiler
	authz.WriteHasAuthzProjectFoothold(&c, sqliteAuthzEnv(), projectID, homeProjectID, principalType, principalID)
	var ok bool
	err := s.client.QueryRow(ctx, c.String(), c.args...).Scan(&ok)
	if err != nil {
		return false, wrapError(err)
	}
	return ok, nil
}

// CheckAuthz implements [service.AuthzResolverStatements].
func (s authzResolverStatements) CheckAuthz(ctx context.Context, params domain.AuthzCheckParams) (bool, bool, error) {
	var c statementCompiler
	authz.WriteCheckAuthz(&c, sqliteAuthzEnv(), params)
	var allowed, foothold bool
	err := s.client.QueryRow(ctx, c.String(), c.args...).Scan(&allowed, &foothold)
	if err != nil {
		return false, false, wrapError(err)
	}
	return allowed, foothold, nil
}

// ListAuthzObjectIDs implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ListAuthzObjectIDs(ctx context.Context, params domain.AuthzListObjectsParams) ([]string, error) {
	var c statementCompiler
	authz.WriteListAuthzObjectIDs(&c, sqliteAuthzEnv(), params)
	rows, err := s.client.Query(ctx, c.String(), c.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	ids, err := collectRows(rows, func(row *sql.Rows) (string, error) {
		var id string
		return id, row.Scan(&id)
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

var _ service.AuthzResolverStatements = (*authzResolverStatements)(nil)
