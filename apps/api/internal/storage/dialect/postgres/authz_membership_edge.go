package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

const (
	// PK no-op DO UPDATE preserves created_at on conflict (Spanner uses
	// created_at = created_at for the same reason — PK columns cannot be updated).
	upsertAuthzMembershipEdgeStmt = `
INSERT INTO zitadel_nextgen.authz_membership_edges (
    project_id, member_type, member_id, set_type, set_id
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (project_id, set_type, set_id, member_type, member_id) DO UPDATE SET
    project_id = EXCLUDED.project_id
RETURNING project_id, member_type, member_id, set_type, set_id, created_at`

	getAuthzMembershipEdgeStmt = `
SELECT project_id, member_type, member_id, set_type, set_id, created_at
FROM zitadel_nextgen.authz_membership_edges
WHERE project_id = $1 AND set_type = $2 AND set_id = $3 AND member_type = $4 AND member_id = $5`

	listAuthzMembershipEdgesByMemberStmt = `
SELECT project_id, member_type, member_id, set_type, set_id, created_at
FROM zitadel_nextgen.authz_membership_edges
WHERE project_id = $1 AND member_type = $2 AND member_id = $3
ORDER BY set_type, set_id`

	// Removes edges for the deactivated team set and for users owned by that team.
	deleteAuthzMembershipEdgesForTeamDeactivateStmt = `
DELETE FROM zitadel_nextgen.authz_membership_edges
WHERE project_id = $1
  AND (
    (set_type = $2 AND set_id = $3)
    OR (
      member_type = $4
      AND member_id IN (
        SELECT id FROM zitadel_nextgen.users
        WHERE project_id = $5 AND lifecycle_owner_team_id = $6
      )
    )
  )`
)

type authzMembershipEdgeStatements struct{ statement }

func newAuthzMembershipEdgeStatements(client queryExecutor) authzMembershipEdgeStatements {
	return authzMembershipEdgeStatements{
		statement: statement{
			client: client,
		},
	}
}

// UpsertAuthzMembershipEdge implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) UpsertAuthzMembershipEdge(ctx context.Context, edge *domain.AuthzMembershipEdge) error {
	return wrapError(s.client.QueryRow(ctx, upsertAuthzMembershipEdgeStmt,
		edge.ProjectID, edge.MemberType.String(), edge.MemberID, edge.SetType.String(), edge.SetID,
	).Scan(&edge.ProjectID, &edge.MemberType, &edge.MemberID, &edge.SetType, &edge.SetID, &edge.CreatedAt))
}

// GetAuthzMembershipEdge implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) GetAuthzMembershipEdge(ctx context.Context, key domain.AuthzMembershipEdgeKey) (*domain.AuthzMembershipEdge, error) {
	rows, err := s.client.Query(ctx, getAuthzMembershipEdgeStmt, key.ProjectID, key.SetType.String(), key.SetID, key.MemberType.String(), key.MemberID)
	if err != nil {
		return nil, wrapError(err)
	}
	edge, err := pgx.CollectExactlyOneRow(rows, scanAuthzMembershipEdge)
	if err != nil {
		return nil, wrapError(err)
	}
	return edge, nil
}

// ListAuthzMembershipEdgesByMember implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) ListAuthzMembershipEdgesByMember(ctx context.Context, projectID string, memberType domain.AuthzMemberType, memberID string) ([]*domain.AuthzMembershipEdge, error) {
	rows, err := s.client.Query(ctx, listAuthzMembershipEdgesByMemberStmt, projectID, memberType.String(), memberID)
	if err != nil {
		return nil, wrapError(err)
	}
	edges, err := pgx.CollectRows(rows, scanAuthzMembershipEdge)
	if err != nil {
		return nil, wrapError(err)
	}
	return edges, nil
}

// DeleteAuthzMembershipEdges implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) DeleteAuthzMembershipEdges(ctx context.Context, filter database.Filter[domain.AuthzMembershipEdgeField]) error {
	if filter == nil {
		return fmt.Errorf("AuthzMembershipEdge filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM zitadel_nextgen.authz_membership_edges WHERE ")
	compileFilter(&c, filter, authz.MembershipEdgeSchema)
	_, err := s.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

// DeleteAuthzMembershipEdgesForTeamDeactivate implements [service.AuthzMembershipEdgeStatements].
// Removes edges for the deactivated team set and for users owned by that team.
// Team RSI is kept (the team row still exists).
func (s authzMembershipEdgeStatements) DeleteAuthzMembershipEdgesForTeamDeactivate(ctx context.Context, projectID, teamID string) error {
	_, err := s.client.Exec(ctx, deleteAuthzMembershipEdgesForTeamDeactivateStmt,
		projectID, domain.AuthzSetTypeTeam.String(), teamID, domain.AuthzMemberTypeUser.String(), projectID, teamID,
	)
	return wrapError(err)
}

func scanAuthzMembershipEdge(row pgx.CollectableRow) (*domain.AuthzMembershipEdge, error) {
	edge := new(domain.AuthzMembershipEdge)
	if err := row.Scan(
		&edge.ProjectID, &edge.MemberType, &edge.MemberID,
		&edge.SetType, &edge.SetID, &edge.CreatedAt,
	); err != nil {
		return nil, err
	}
	return edge, nil
}

var _ service.AuthzMembershipEdgeStatements = (*authzMembershipEdgeStatements)(nil)
