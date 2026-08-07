package spanner

import (
	"context"
	"fmt"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/authz"
)

const (
	authzMembershipEdgesTable = "authz_membership_edges"

	// Spanner rejects updating primary-key columns (even to the same value), so
	// the Postgres/SQLite PK no-op upsert cannot be used. Touch created_at with
	// its existing value so THEN RETURN still yields the row on conflict.
	upsertAuthzMembershipEdgeStmt = `
INSERT INTO authz_membership_edges (project_id, member_type, member_id, set_type, set_id)
VALUES (@p1, @p2, @p3, @p4, @p5)
ON CONFLICT (project_id, set_type, set_id, member_type, member_id) DO UPDATE SET
    created_at = authz_membership_edges.created_at
THEN RETURN project_id, member_type, member_id, set_type, set_id, created_at`

	listAuthzMembershipEdgesByMemberStmt = `
SELECT project_id, member_type, member_id, set_type, set_id, created_at
FROM authz_membership_edges
WHERE project_id = @p1 AND member_type = @p2 AND member_id = @p3
ORDER BY set_type, set_id`

	deleteAuthzMembershipEdgesForTeamDeactivateStmt = `
DELETE FROM authz_membership_edges
WHERE project_id = @p1
  AND (
    (set_type = @p2 AND set_id = @p3)
    OR (
      member_type = @p4
      AND member_id IN (
        SELECT id FROM users
        WHERE project_id = @p5 AND lifecycle_owner_team_id = @p6
      )
    )
  )`
)

var authzMembershipEdgeColumns = []string{
	"project_id", "member_type", "member_id", "set_type", "set_id", "created_at",
}

type authzMembershipEdgeStatements struct{ statement }

func newAuthzMembershipEdgeStatements(db queryExecutor) authzMembershipEdgeStatements {
	return authzMembershipEdgeStatements{
		statement: statement{
			db: db,
		},
	}
}

// UpsertAuthzMembershipEdge implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) UpsertAuthzMembershipEdge(ctx context.Context, edge *domain.AuthzMembershipEdge) error {
	stmt := buildStatement(upsertAuthzMembershipEdgeStmt,
		edge.ProjectID, edge.MemberType.String(), edge.MemberID, edge.SetType.String(), edge.SetID,
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		updated, err := collectOneRow(iter, scanAuthzMembershipEdge)
		if err != nil {
			return err
		}
		*edge = *updated
		return nil
	})
}

// GetAuthzMembershipEdge implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) GetAuthzMembershipEdge(ctx context.Context, key domain.AuthzMembershipEdgeKey) (*domain.AuthzMembershipEdge, error) {
	row, err := s.db.ReadRow(ctx, authzMembershipEdgesTable, spanner.Key{key.ProjectID, key.SetType.String(), key.SetID, key.MemberType.String(), key.MemberID}, authzMembershipEdgeColumns)
	if err != nil {
		return nil, err
	}
	return scanAuthzMembershipEdge(row)
}

// ListAuthzMembershipEdgesByMember implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) ListAuthzMembershipEdgesByMember(ctx context.Context, projectID string, memberType domain.AuthzMemberType, memberID string) ([]*domain.AuthzMembershipEdge, error) {
	var edges []*domain.AuthzMembershipEdge
	err := s.db.Query(ctx, buildStatement(listAuthzMembershipEdgesByMemberStmt, projectID, memberType.String(), memberID).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		edges, qErr = collectRows(iter, scanAuthzMembershipEdge)
		return qErr
	})
	return edges, err
}

// DeleteAuthzMembershipEdges implements [service.AuthzMembershipEdgeStatements].
func (s authzMembershipEdgeStatements) DeleteAuthzMembershipEdges(ctx context.Context, filter database.Filter[domain.AuthzMembershipEdgeField]) error {
	if filter == nil {
		return fmt.Errorf("AuthzMembershipEdge filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM authz_membership_edges WHERE ")
	compileFilter(&c, filter, authz.MembershipEdgeSchema)
	_, err := s.db.Update(ctx, c.statement())
	return wrapError(err)
}

// DeleteAuthzMembershipEdgesForTeamDeactivate implements [service.AuthzMembershipEdgeStatements].
// Removes edges for the deactivated team set and for users owned by that team.
// Team RSI is kept (the team row still exists).
func (s authzMembershipEdgeStatements) DeleteAuthzMembershipEdgesForTeamDeactivate(ctx context.Context, projectID, teamID string) error {
	_, err := s.db.Update(ctx, buildStatement(deleteAuthzMembershipEdgesForTeamDeactivateStmt,
		projectID, domain.AuthzSetTypeTeam.String(), teamID, domain.AuthzMemberTypeUser.String(), projectID, teamID,
	).statement())
	return err
}

func scanAuthzMembershipEdge(row *spanner.Row) (*domain.AuthzMembershipEdge, error) {
	edge := new(domain.AuthzMembershipEdge)
	if err := row.Columns(
		&edge.ProjectID, &edge.MemberType, &edge.MemberID,
		&edge.SetType, &edge.SetID, &edge.CreatedAt,
	); err != nil {
		return nil, err
	}
	return edge, nil
}

var _ service.AuthzMembershipEdgeStatements = (*authzMembershipEdgeStatements)(nil)
