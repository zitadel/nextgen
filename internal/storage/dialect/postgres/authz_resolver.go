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

var (
	pgAuthz                     = authz.PostgresSQL()
	activeSystemCatalogIDStmt   = pgAuthz.ActiveSystemCatalogID()
	hasAuthzProjectFootholdStmt = pgAuthz.HasAuthzProjectFoothold()
	checkAuthzStmt              = pgAuthz.CheckAuthz()
	listAuthzObjectIDsStmt      = pgAuthz.ListAuthzObjectIDs()
)

type authzResolverStatements struct{ statement }

func newAuthzResolverStatements(client queryExecutor) authzResolverStatements {
	return authzResolverStatements{statement: statement{client: client}}
}

// ActiveSystemCatalogID implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ActiveSystemCatalogID(ctx context.Context) (string, error) {
	var id string
	err := s.client.QueryRow(ctx, activeSystemCatalogIDStmt,
		domain.AuthzCatalogKindSystem.String(),
		domain.SystemCatalogOwnerID,
		domain.AuthzCatalogStatusActive.String(),
	).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", database.NewNoRowFoundError(nil)
		}
		return "", wrapError(err)
	}
	return id, nil
}

// HasAuthzProjectFoothold implements [service.AuthzResolverStatements].
func (s authzResolverStatements) HasAuthzProjectFoothold(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error) {
	var ok bool
	err := s.client.QueryRow(ctx, hasAuthzProjectFootholdStmt,
		projectID, principalType.String(), principalID,
	).Scan(&ok)
	if err != nil {
		return false, wrapError(err)
	}
	return ok, nil
}

// CheckAuthz implements [service.AuthzResolverStatements].
func (s authzResolverStatements) CheckAuthz(ctx context.Context, params domain.AuthzCheckParams) (bool, error) {
	home := params.PrincipalHomeProjectID
	if home == "" {
		home = params.ProjectID
	}
	var ok bool
	err := s.client.QueryRow(ctx, checkAuthzStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		home,
	).Scan(&ok)
	if err != nil {
		return false, wrapError(err)
	}
	return ok, nil
}

// ListAuthzObjectIDs implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ListAuthzObjectIDs(ctx context.Context, params domain.AuthzListObjectsParams) ([]string, error) {
	home := params.PrincipalHomeProjectID
	if home == "" {
		home = params.ProjectID
	}
	rows, err := s.client.Query(ctx, listAuthzObjectIDsStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		home,
		params.ResourceKind.String(),
	)
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
