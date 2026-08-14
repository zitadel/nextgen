//go:build spanner_integration

package spanner

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func uniqueFlowDefinitionID(t *testing.T) string {
	t.Helper()
	return "flow-" + uniqueSuffix(t)
}

func sampleFlowDefinition(projectID, id string) *domain.FlowDefinition {
	return &domain.FlowDefinition{
		ProjectID:     projectID,
		ID:            id,
		Name:          "Default Login",
		SchemaVersion: "1.0.0",
		Status:        domain.FlowDefinitionStatusDraft,
		UserSchema:    "https://example.com/schemas/human-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "identifier",
		},
		Audience: domain.FlowDefinitionAudience{
			AppIDs: []string{"app-1"},
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, TextKey: "identifier.submit", Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: new(domain.FlowStepCompleteRedirect)},
		},
	}
}

func TestFlowDefinitionStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	def := sampleFlowDefinition(project.ID, uniqueFlowDefinitionID(t))
	require.NoError(t, stmts.CreateFlowDefinition(ctx, def))
	t.Cleanup(func() { _ = stmts.DeleteFlowDefinitionByID(context.Background(), project.ID, def.ID) })

	got, err := stmts.GetFlowDefinitionByID(ctx, project.ID, def.ID)
	require.NoError(t, err)
	assert.Equal(t, def.ID, got.ID)
	assert.Equal(t, def.Name, got.Name)
	assert.Equal(t, def.Status, got.Status)
	assert.Equal(t, def.UserSchema, got.UserSchema)
	assert.Equal(t, def.Purposes, got.Purposes)

	listed, err := stmts.ListFlowDefinitions(service.WithAuthzListFilterBypass(ctx), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), project.ID),
			database.ArrayContains(database.Col(domain.FlowDefinitionFieldPurposes), domain.FlowDefinitionPurposeLogin.String()),
		),
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, def.ID, listed.Items[0].ID)

	def.Name = "Updated Login"
	def.Status = domain.FlowDefinitionStatusActive
	require.NoError(t, stmts.UpdateFlowDefinition(ctx, def))

	got, err = stmts.GetFlowDefinitionByID(ctx, project.ID, def.ID)
	require.NoError(t, err)
	assert.Equal(t, "Updated Login", got.Name)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got.Status)

	require.NoError(t, stmts.DeleteFlowDefinitionByID(ctx, project.ID, def.ID))
	_, err = stmts.GetFlowDefinitionByID(ctx, project.ID, def.ID)
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestFlowDefinitionStatements_DeleteProjectCascades(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))

	def := sampleFlowDefinition(project.ID, uniqueFlowDefinitionID(t))
	require.NoError(t, stmts.CreateFlowDefinition(ctx, def))

	require.NoError(t, stmts.DeleteProjectByID(ctx, project.ID))

	_, err := stmts.GetFlowDefinitionByID(ctx, project.ID, def.ID)
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
