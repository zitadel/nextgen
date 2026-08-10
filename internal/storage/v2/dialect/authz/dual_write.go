package authz

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// UserCreated dual-writes user RSI and an optional initial team membership edge.
func UserCreated(ctx context.Context, rsi service.ResourceScopeStatements, edges service.AuthzMembershipEdgeStatements, projectID, userID, initialTeamID string) error {
	if err := rsi.UpsertResourceScope(ctx, domain.NewUserResourceScope(projectID, userID)); err != nil {
		return err
	}
	if initialTeamID == "" {
		return nil
	}
	return service.SyncUserTeamMembershipEdge(ctx, edges, projectID, initialTeamID, userID, domain.MembershipStatusActive)
}

// UserDeactivated clears all membership edges for the user (RSI is kept).
func UserDeactivated(ctx context.Context, edges service.AuthzMembershipEdgeStatements, projectID, userID string) error {
	return edges.DeleteAuthzMembershipEdges(ctx, edgesByMember(projectID, userID))
}

// UserDeleted clears membership edges and the user resource scope.
func UserDeleted(ctx context.Context, rsi service.ResourceScopeStatements, edges service.AuthzMembershipEdgeStatements, projectID, userID string) error {
	if err := edges.DeleteAuthzMembershipEdges(ctx, edgesByMember(projectID, userID)); err != nil {
		return err
	}
	return rsi.DeleteResourceScope(ctx, userID)
}

func edgesByMember(projectID, userID string) database.Filter[domain.AuthzMembershipEdgeField] {
	return database.And(
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldProjectID), projectID),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberType), domain.AuthzMemberTypeUser),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberID), userID),
	)
}
