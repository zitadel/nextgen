//go:build postgres_integration

package postgres

import (
	"context"
	"testing"
	"time"

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
	pivotAction := domain.Pivot
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
					"submit":   {Target: "done"},
					"register": {Action: &pivotAction, Target: "register-flow"},
				},
			},
		},
	}
}

func TestFlowDefinitionStatements_CreateAndGet(t *testing.T) {
	projectID := uniqueProjectID(t)
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))

	def := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t))
	t.Cleanup(func() { _ = testPool.DeleteFlowDefinitionByID(context.Background(), projectID, def.ID) })

	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), def))

	got, err := testPool.GetFlowDefinitionByID(t.Context(), projectID, def.ID)
	require.NoError(t, err)
	assert.Equal(t, def.ID, got.ID)
	assert.Equal(t, def.Name, got.Name)
	assert.Equal(t, def.SchemaVersion, got.SchemaVersion)
	assert.Equal(t, def.Status, got.Status)
	assert.Equal(t, def.UserSchema, got.UserSchema)
	assert.Equal(t, def.Purposes, got.Purposes)
	assert.Equal(t, def.Audience.AppIDs, got.Audience.AppIDs)
	assert.WithinDuration(t, time.Now(), got.CreatedAt, 5*time.Second)
	assert.WithinDuration(t, time.Now(), got.UpdatedAt, 5*time.Second)
}

func TestFlowDefinitionStatements_GetNotFound(t *testing.T) {
	_, err := testPool.GetFlowDefinitionByID(t.Context(), uniqueProjectID(t), uniqueFlowDefinitionID(t))
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestFlowDefinitionStatements_ListAndDelete(t *testing.T) {
	projectID := uniqueProjectID(t)
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))

	def := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t))
	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), def))

	listed, err := testPool.ListFlowDefinitions(service.WithAuthzListUnrestricted(t.Context()), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
			database.Equal(database.Col(domain.FlowDefinitionFieldName), def.Name),
		),
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, def.ID, listed.Items[0].ID)

	require.NoError(t, testPool.DeleteFlowDefinitionByID(t.Context(), projectID, def.ID))
	_, err = testPool.GetFlowDefinitionByID(t.Context(), projectID, def.ID)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestFlowDefinitionStatements_Update(t *testing.T) {
	projectID := uniqueProjectID(t)
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))

	def := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t))
	t.Cleanup(func() { _ = testPool.DeleteFlowDefinitionByID(context.Background(), projectID, def.ID) })
	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), def))

	def.Name = "Updated Login"
	def.Status = domain.FlowDefinitionStatusActive
	def.SchemaVersion = "2.0.0"
	require.NoError(t, testPool.UpdateFlowDefinition(t.Context(), def))

	got, err := testPool.GetFlowDefinitionByID(t.Context(), projectID, def.ID)
	require.NoError(t, err)
	assert.Equal(t, "Updated Login", got.Name)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got.Status)
	assert.Equal(t, "2.0.0", got.SchemaVersion)
}

func TestFlowDefinitionStatements_ListByPurpose(t *testing.T) {
	projectID := uniqueProjectID(t)
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))

	login := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t)+"-login")
	register := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t)+"-register")
	register.Name = "Register"
	register.Purposes = map[domain.FlowDefinitionPurpose]string{
		domain.FlowDefinitionPurposeRegister: "identifier",
	}
	t.Cleanup(func() {
		_ = testPool.DeleteFlowDefinitionByID(context.Background(), projectID, login.ID)
		_ = testPool.DeleteFlowDefinitionByID(context.Background(), projectID, register.ID)
	})
	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), login))
	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), register))

	listed, err := testPool.ListFlowDefinitions(service.WithAuthzListUnrestricted(t.Context()), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
			database.ArrayContains(database.Col(domain.FlowDefinitionFieldPurposes), domain.FlowDefinitionPurposeLogin.String()),
		),
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, login.ID, listed.Items[0].ID)
}

func TestFlowDefinitionStatements_ListByStatus(t *testing.T) {
	projectID := uniqueProjectID(t)
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))

	draft := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t)+"-draft")
	active := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t)+"-active")
	active.Name = "Active Login"
	active.Status = domain.FlowDefinitionStatusActive
	t.Cleanup(func() {
		_ = testPool.DeleteFlowDefinitionByID(context.Background(), projectID, draft.ID)
		_ = testPool.DeleteFlowDefinitionByID(context.Background(), projectID, active.ID)
	})
	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), draft))
	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), active))

	listed, err := testPool.ListFlowDefinitions(service.WithAuthzListUnrestricted(t.Context()), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
			database.Equal(database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
		),
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, active.ID, listed.Items[0].ID)
}

func TestFlowDefinitionStatements_DeleteProjectCascades(t *testing.T) {
	projectID := uniqueProjectID(t)
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))

	def := sampleFlowDefinition(projectID, uniqueFlowDefinitionID(t))
	require.NoError(t, testPool.CreateFlowDefinition(t.Context(), def))

	require.NoError(t, testPool.DeleteProjectByID(t.Context(), projectID))

	_, err := testPool.GetFlowDefinitionByID(t.Context(), projectID, def.ID)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
