package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

var (
	activeSystemCatalogIDStmt   = authz.SQLiteSQL(0).ActiveSystemCatalogID()
	hasAuthzProjectFootholdStmt = authz.SQLiteSQL(4).HasAuthzProjectFoothold()
	checkAuthzStmt              = authz.SQLiteSQL(8).CheckAuthz()
	listAuthzObjectIDsStmt      = authz.SQLiteSQL(9).ListAuthzObjectIDs()
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
		if err == sql.ErrNoRows {
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
		projectID, principalType.String(), principalID, nowUnixNano(),
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
		nowUnixNano(),
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
		nowUnixNano(),
	)
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
