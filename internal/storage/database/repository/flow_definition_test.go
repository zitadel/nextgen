package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func newFlowDefinitionRepo() *repository.FlowDefinitionRepository {
	return &repository.FlowDefinitionRepository{Client: pool}
}

func sampleFlowDefinition(instanceID, id string) *domain.FlowDefinition {
	pivot := domain.FlowDefinitionPurposeRegister
	appID := "app-1"
	return &domain.FlowDefinition{
		InstanceID:    instanceID,
		ID:            id,
		Name:          "Default Login",
		EngineVersion: "1.0.0",
		SchemaVersion: "1.0.0",
		Status:        domain.FlowDefinitionStatusDraft,
		Purposes: []domain.FlowDefinitionPurposeEntry{
			{Purpose: domain.FlowDefinitionPurposeLogin, InitialStep: "identifier"},
		},
		Audience: domain.FlowDefinitionAudience{
			AppID:             &appID,
			IsInstanceDefault: false,
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "identifier",
				Type: domain.FlowStepTypeIdentifier,
				Config: map[string]any{
					"methods": []any{"email"},
				},
				Transitions: []domain.FlowStepTransition{
					{Action: "submit", TargetStep: strPtr("resolve_user")},
					{Action: "register", PivotPurpose: &pivot},
				},
			},
			{
				Name:   "resolve_user",
				Type:   domain.FlowStepTypePolicyCheck,
				Config: nil,
				Transitions: []domain.FlowStepTransition{
					{Action: "found", TargetStep: strPtr("password")},
				},
			},
			{
				Name:        "password",
				Type:        domain.FlowStepTypeCredential,
				Config:      map[string]any{"factor": "password"},
				Transitions: []domain.FlowStepTransition{},
			},
		},
	}
}

func strPtr(s string) *string { return &s }

func TestFlowDefinitionRepository_CreateAndGet(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}
	def := sampleFlowDefinition("inst-1", "flow-1")

	err := repo.CreateFlowDefinition(t.Context(), def)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), "inst-1", "flow-1")
	require.NoError(t, err)

	assert.Equal(t, def.ID, got.ID)
	assert.Equal(t, def.Name, got.Name)
	assert.Equal(t, def.EngineVersion, got.EngineVersion)
	assert.Equal(t, def.SchemaVersion, got.SchemaVersion)
	assert.Equal(t, def.Status, got.Status)
	assert.WithinDuration(t, time.Now(), got.CreatedAt, 5*time.Second)
	assert.WithinDuration(t, time.Now(), got.UpdatedAt, 5*time.Second)

	require.Len(t, got.Purposes, 1)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, got.Purposes[0].Purpose)
	assert.Equal(t, "identifier", got.Purposes[0].InitialStep)

	assert.Equal(t, def.Audience.AppID, got.Audience.AppID)
	assert.Nil(t, got.Audience.OrgID)
	assert.False(t, got.Audience.IsInstanceDefault)

	require.Len(t, got.Steps, 3)
	stepsByName := make(map[string]domain.FlowDefinitionStep)
	for _, s := range got.Steps {
		stepsByName[s.Name] = s
	}

	identifier := stepsByName["identifier"]
	assert.Equal(t, domain.FlowStepTypeIdentifier, identifier.Type)
	assert.Equal(t, []any{"email"}, identifier.Config["methods"])
	require.Len(t, identifier.Transitions, 2)

	transitionsByAction := make(map[string]domain.FlowStepTransition)
	for _, tr := range identifier.Transitions {
		transitionsByAction[tr.Action] = tr
	}
	assert.Equal(t, strPtr("resolve_user"), transitionsByAction["submit"].TargetStep)
	assert.Nil(t, transitionsByAction["submit"].PivotPurpose)

	registerPivot := transitionsByAction["register"]
	require.NotNil(t, registerPivot.PivotPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, *registerPivot.PivotPurpose)
	assert.Nil(t, registerPivot.TargetStep)
}

func TestFlowDefinitionRepository_GetNotFound(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}

	_, err := repo.GetFlowDefinition(t.Context(), "inst-missing", "flow-missing")
	require.Error(t, err)
}

func TestFlowDefinitionRepository_List(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}

	for _, id := range []string{"flow-a", "flow-b", "flow-c"} {
		def := sampleFlowDefinition("inst-list", id)
		if id == "flow-b" {
			def.Status = domain.FlowDefinitionStatusActive
		}
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))
	}

	all, err := repo.ListFlowDefinitions(t.Context(), "inst-list")
	require.NoError(t, err)
	assert.Len(t, all, 3)

	active, err := repo.ListFlowDefinitions(t.Context(), "inst-list",
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive))
	require.NoError(t, err)
	require.Len(t, active, 1)
	assert.Equal(t, "flow-b", active[0].ID)
}

func TestFlowDefinitionRepository_ListPagination(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}

	for _, id := range []string{"flow-p1", "flow-p2", "flow-p3", "flow-p4"} {
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("inst-page", id)))
	}

	page1, err := repo.ListFlowDefinitions(t.Context(), "inst-page",
		domain.WithFlowDefinitionLimit(2))
	require.NoError(t, err)
	assert.Len(t, page1, 2)

	page2, err := repo.ListFlowDefinitions(t.Context(), "inst-page",
		domain.WithFlowDefinitionLimit(2),
		domain.WithFlowDefinitionOffset(2))
	require.NoError(t, err)
	assert.Len(t, page2, 2)

	assert.NotEqual(t, page1[0].ID, page2[0].ID)
}

func TestFlowDefinitionRepository_UpdateStatus(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}
	def := sampleFlowDefinition("inst-upd", "flow-upd")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))

	err := repo.UpdateFlowDefinitionStatus(t.Context(), "inst-upd", "flow-upd", domain.FlowDefinitionStatusActive)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), "inst-upd", "flow-upd")
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got.Status)
}

func TestFlowDefinitionRepository_Delete(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}
	def := sampleFlowDefinition("inst-del", "flow-del")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))

	err := repo.DeleteFlowDefinition(t.Context(), "inst-del", "flow-del")
	require.NoError(t, err)

	_, err = repo.GetFlowDefinition(t.Context(), "inst-del", "flow-del")
	require.Error(t, err)
}

func TestFlowDefinitionRepository_DeleteCascadesToChildren(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}
	def := sampleFlowDefinition("inst-casc", "flow-casc")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))

	err := repo.DeleteFlowDefinition(t.Context(), "inst-casc", "flow-casc")
	require.NoError(t, err)

	// Re-insert with the same id must succeed (no orphaned child rows remain).
	fresh := sampleFlowDefinition("inst-casc", "flow-casc")
	err = repo.CreateFlowDefinition(t.Context(), fresh)
	require.NoError(t, err)
}

func TestFlowDefinitionRepository_InstanceIsolation(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionRepository{Client: tx}
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("inst-A", "flow-1")))
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("inst-B", "flow-1")))

	listA, err := repo.ListFlowDefinitions(t.Context(), "inst-A")
	require.NoError(t, err)
	assert.Len(t, listA, 1)

	listB, err := repo.ListFlowDefinitions(t.Context(), "inst-B")
	require.NoError(t, err)
	assert.Len(t, listB, 1)

	_, err = repo.GetFlowDefinition(t.Context(), "inst-A", "flow-1")
	require.NoError(t, err)

	_, err = repo.GetFlowDefinition(t.Context(), "inst-B", "flow-1")
	require.NoError(t, err)
}
