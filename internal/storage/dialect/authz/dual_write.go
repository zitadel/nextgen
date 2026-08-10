package authz

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
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

// SchemaCreated dual-writes the schema URL into resource_scope_index.
func SchemaCreated(ctx context.Context, rsi service.ResourceScopeStatements, projectID, schemaURL string) error {
	return rsi.UpsertResourceScope(ctx, domain.NewSchemaResourceScope(projectID, schemaURL))
}

// SchemaDeleted removes the schema resource_scope_index row.
func SchemaDeleted(ctx context.Context, rsi service.ResourceScopeStatements, schemaURL string) error {
	return rsi.DeleteResourceScope(ctx, schemaURL)
}

// BrandingCreated dual-writes a branding revision into resource_scope_index.
// Branding rows are immutable; project delete cascades RSI cleanup.
func BrandingCreated(ctx context.Context, rsi service.ResourceScopeStatements, projectID, brandingID string) error {
	return rsi.UpsertResourceScope(ctx, domain.NewBrandingResourceScope(projectID, brandingID))
}

// FlowDefinitionCreated dual-writes a flow definition into resource_scope_index.
func FlowDefinitionCreated(ctx context.Context, rsi service.ResourceScopeStatements, projectID, flowDefinitionID string) error {
	return rsi.UpsertResourceScope(ctx, domain.NewFlowDefinitionResourceScope(projectID, flowDefinitionID))
}

// FlowDefinitionDeleted removes the flow definition resource_scope_index row.
func FlowDefinitionDeleted(ctx context.Context, rsi service.ResourceScopeStatements, flowDefinitionID string) error {
	return rsi.DeleteResourceScope(ctx, flowDefinitionID)
}

// SessionCreated dual-writes a session into resource_scope_index.
func SessionCreated(ctx context.Context, rsi service.ResourceScopeStatements, projectID, sessionID string) error {
	return rsi.UpsertResourceScope(ctx, domain.NewSessionResourceScope(projectID, sessionID))
}

// SessionDeleted removes the session resource_scope_index row.
func SessionDeleted(ctx context.Context, rsi service.ResourceScopeStatements, sessionID string) error {
	return rsi.DeleteResourceScope(ctx, sessionID)
}

func edgesByMember(projectID, userID string) database.Filter[domain.AuthzMembershipEdgeField] {
	return database.And(
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldProjectID), projectID),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberType), domain.AuthzMemberTypeUser),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberID), userID),
	)
}
