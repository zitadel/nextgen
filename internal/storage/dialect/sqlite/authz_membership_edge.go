package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

const (
	// PK no-op DO UPDATE preserves created_at on conflict (Spanner uses
	// created_at = created_at for the same reason — PK columns cannot be updated).
	upsertAuthzMembershipEdgeStmt = `
INSERT INTO authz_membership_edges (
    project_id, member_type, member_id, set_type, set_id, created_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (project_id, set_type, set_id, member_type, member_id) DO UPDATE SET
    project_id = excluded.project_id
RETURNING project_id, member_type, member_id, set_type, set_id, created_at`

	getAuthzMembershipEdgeStmt = `
SELECT project_id, member_type, member_id, set_type, set_id, created_at
FROM authz_membership_edges
WHERE project_id = ? AND set_type = ? AND set_id = ? AND member_type = ? AND member_id = ?`

	listAuthzMembershipEdgesByMemberStmt = `
SELECT project_id, member_type, member_id, set_type, set_id, created_at
FROM authz_membership_edges
WHERE project_id = ? AND member_type = ? AND member_id = ?
ORDER BY set_type, set_id`

	deleteAuthzMembershipEdgesForTeamDeactivateStmt = `
DELETE FROM authz_membership_edges
WHERE project_id = ?
  AND (
    (set_type = ? AND set_id = ?)
    OR (
      member_type = ?
      AND member_id IN (
        SELECT id FROM users
        WHERE project_id = ? AND lifecycle_owner_team_id = ?
      )
    )
  )`
)

type authzMembershipEdgeStatements struct{ statement }

func newAuthzMembershipEdgeStatements(client queryExecutor) authzMembershipEdgeStatements {
	return authzMembershipEdgeStatements{statement: statement{client: client}}
}

// UpsertAuthzMembershipEdge implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) UpsertAuthzMembershipEdge(ctx context.Context, edge *domain.AuthzMembershipEdge) error {
	now := nowUnixNano()
	var createdNano int64
	err := s.client.QueryRow(ctx, upsertAuthzMembershipEdgeStmt,
		edge.ProjectID, edge.MemberType.String(), edge.MemberID, edge.SetType.String(), edge.SetID, now,
	).Scan(&edge.ProjectID, &edge.MemberType, &edge.MemberID, &edge.SetType, &edge.SetID, &createdNano)
	if err != nil {
		return wrapError(err)
	}
	edge.CreatedAt = timeFromUnixNano(createdNano)
	return nil
}

// GetAuthzMembershipEdge implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) GetAuthzMembershipEdge(ctx context.Context, key domain.AuthzMembershipEdgeKey) (*domain.AuthzMembershipEdge, error) {
	rows, err := s.client.Query(ctx, getAuthzMembershipEdgeStmt, key.ProjectID, key.SetType.String(), key.SetID, key.MemberType.String(), key.MemberID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	edge, err := collectExactlyOneRow(rows, scanAuthzMembershipEdge)
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
	defer rows.Close()
	edges, err := collectRows(rows, scanAuthzMembershipEdge)
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
	c.WriteString("DELETE FROM authz_membership_edges WHERE ")
	compileFilter(&c, filter, authz.MembershipEdgeSchema)
	_, err := s.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

// DeleteAuthzMembershipEdgesForTeamDeactivate implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) DeleteAuthzMembershipEdgesForTeamDeactivate(ctx context.Context, projectID, teamID string) error {
	_, err := s.client.Exec(ctx, deleteAuthzMembershipEdgesForTeamDeactivateStmt,
		projectID, domain.AuthzSetTypeTeam.String(), teamID, domain.AuthzMemberTypeUser.String(), projectID, teamID,
	)
	return wrapError(err)
}

func scanAuthzMembershipEdge(rows *sql.Rows) (*domain.AuthzMembershipEdge, error) {
	edge := new(domain.AuthzMembershipEdge)
	var createdNano int64
	if err := rows.Scan(
		&edge.ProjectID, &edge.MemberType, &edge.MemberID,
		&edge.SetType, &edge.SetID, &createdNano,
	); err != nil {
		return nil, err
	}
	edge.CreatedAt = timeFromUnixNano(createdNano)
	return edge, nil
}

var _ service.AuthzMembershipEdgeStatements = (*authzMembershipEdgeStatements)(nil)
