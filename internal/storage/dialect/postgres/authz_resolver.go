package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func postgresAuthzEnv() authz.Env {
	return authz.Env{
		Schema: "zitadel_nextgen.",
		Now:    func(w authz.ArgWriter) { w.WriteString("now()") },
	}
}

type authzResolverStatements struct{ statement }

func newAuthzResolverStatements(client queryExecutor) authzResolverStatements {
	return authzResolverStatements{statement: statement{client: client}}
}

// ActiveSystemCatalogID implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ActiveSystemCatalogID(ctx context.Context) (string, error) {
	return authz.LoadOrFetchActiveSystemCatalogID(func() (string, error) {
		var c statementCompiler
		authz.WriteActiveSystemCatalogID(&c, postgresAuthzEnv())
		var id string
		err := s.client.QueryRow(ctx, c.String(), c.args...).Scan(&id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", database.NewNoRowFoundError(nil)
			}
			return "", wrapError(err)
		}
		return id, nil
	})
}

// HasAuthzProjectFoothold implements [service.AuthzResolverStatements].
func (s authzResolverStatements) HasAuthzProjectFoothold(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error) {
	var c statementCompiler
	authz.WriteHasAuthzProjectFoothold(&c, postgresAuthzEnv(), projectID, principalType, principalID)
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
	authz.WriteCheckAuthz(&c, postgresAuthzEnv(), params)
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
	authz.WriteListAuthzObjectIDs(&c, postgresAuthzEnv(), params)
	rows, err := s.client.Query(ctx, c.String(), c.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	ids, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (string, error) {
		var id string
		return id, row.Scan(&id)
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

var _ service.AuthzResolverStatements = (*authzResolverStatements)(nil)
