package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestFlowDefinitionRepository_CreateAndGet(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)
	def := sampleFlowDefinition("proj-j1", "flow-j1")

	err := repo.CreateFlowDefinition(t.Context(), def)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), "proj-j1", "flow-j1")
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
	assert.Nil(t, got.Audience.TeamID)
	assert.False(t, got.Audience.IsProjectDefault)

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
	assert.Equal(t, new("resolve_user"), transitionsByAction["submit"].TargetStep)
	assert.Nil(t, transitionsByAction["submit"].PivotPurpose)

	registerPivot := transitionsByAction["register"]
	require.NotNil(t, registerPivot.PivotPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, *registerPivot.PivotPurpose)
	assert.Nil(t, registerPivot.TargetStep)
}

func TestFlowDefinitionRepository_GetNotFound(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)

	_, err := repo.GetFlowDefinition(t.Context(), "proj-missing", "flow-missing")
	require.Error(t, err)
}

func TestFlowDefinitionRepository_List(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)

	for _, id := range []string{"flow-ja", "flow-jb", "flow-jc"} {
		def := sampleFlowDefinition("proj-jlist", id)
		if id == "flow-jb" {
			def.Status = domain.FlowDefinitionStatusActive
		}
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))
	}

	all, err := repo.ListFlowDefinitions(t.Context(), "proj-jlist")
	require.NoError(t, err)
	assert.Len(t, all, 3)

	active, err := repo.ListFlowDefinitions(t.Context(), "proj-jlist",
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive))
	require.NoError(t, err)
	require.Len(t, active, 1)
	assert.Equal(t, "flow-jb", active[0].ID)
}

func TestFlowDefinitionRepository_ListByPurpose(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)

	// flow-pa: serves login only (via sampleFlowDefinition)
	defA := sampleFlowDefinition("proj-jpurp", "flow-pa")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), defA))

	// flow-pb: serves both login and register
	defB := sampleFlowDefinition("proj-jpurp", "flow-pb")
	defB.Purposes = append(defB.Purposes, domain.FlowDefinitionPurposeEntry{
		Purpose:     domain.FlowDefinitionPurposeRegister,
		InitialStep: "start",
	})
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), defB))

	loginOnly, err := repo.ListFlowDefinitions(t.Context(), "proj-jpurp",
		domain.WithFlowDefinitionPurpose(domain.FlowDefinitionPurposeLogin))
	require.NoError(t, err)
	assert.Len(t, loginOnly, 2)

	registerOnly, err := repo.ListFlowDefinitions(t.Context(), "proj-jpurp",
		domain.WithFlowDefinitionPurpose(domain.FlowDefinitionPurposeRegister))
	require.NoError(t, err)
	require.Len(t, registerOnly, 1)
	assert.Equal(t, "flow-pb", registerOnly[0].ID)
}

func TestFlowDefinitionRepository_ListPagination(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)

	for _, id := range []string{"flow-jp1", "flow-jp2", "flow-jp3", "flow-jp4"} {
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("proj-jpage", id)))
	}

	page1, err := repo.ListFlowDefinitions(t.Context(), "proj-jpage",
		domain.WithFlowDefinitionLimit(2))
	require.NoError(t, err)
	assert.Len(t, page1, 2)

	page2, err := repo.ListFlowDefinitions(t.Context(), "proj-jpage",
		domain.WithFlowDefinitionLimit(2),
		domain.WithFlowDefinitionOffset(2))
	require.NoError(t, err)
	assert.Len(t, page2, 2)

	assert.NotEqual(t, page1[0].ID, page2[0].ID)
}

func TestFlowDefinitionRepository_UpdateStatus(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)
	def := sampleFlowDefinition("proj-jupd", "flow-jupd")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))

	err := repo.UpdateFlowDefinitionStatus(t.Context(), "proj-jupd", "flow-jupd", domain.FlowDefinitionStatusActive)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), "proj-jupd", "flow-jupd")
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got.Status)
}

func TestFlowDefinitionRepository_Delete(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)
	def := sampleFlowDefinition("proj-jdel", "flow-jdel")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))

	err := repo.DeleteFlowDefinition(t.Context(), "proj-jdel", "flow-jdel")
	require.NoError(t, err)

	_, err = repo.GetFlowDefinition(t.Context(), "proj-jdel", "flow-jdel")
	require.Error(t, err)
}

func TestFlowDefinitionRepository_ProjectIsolation(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewPostgresFlowDefinitionRepository(tx)
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("proj-jA", "flow-j1")))
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("proj-jB", "flow-j1")))

	listA, err := repo.ListFlowDefinitions(t.Context(), "proj-jA")
	require.NoError(t, err)
	assert.Len(t, listA, 1)

	listB, err := repo.ListFlowDefinitions(t.Context(), "proj-jB")
	require.NoError(t, err)
	assert.Len(t, listB, 1)
}

func sampleFlowDefinition(projectID, id string) *domain.FlowDefinition {
	pivot := domain.FlowDefinitionPurposeRegister
	appID := "app-1"
	return &domain.FlowDefinition{
		ProjectID:     projectID,
		ID:            id,
		Name:          "Default Login",
		EngineVersion: "1.0.0",
		SchemaVersion: "1.0.0",
		Status:        domain.FlowDefinitionStatusDraft,
		Purposes: []domain.FlowDefinitionPurposeEntry{
			{Purpose: domain.FlowDefinitionPurposeLogin, InitialStep: "identifier"},
		},
		Audience: domain.FlowDefinitionAudience{
			AppID:            &appID,
			IsProjectDefault: false,
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "identifier",
				Type: domain.FlowStepTypeIdentifier,
				Config: map[string]any{
					"methods": []any{"email"},
				},
				Transitions: []domain.FlowStepTransition{
					{Action: "submit", TargetStep: new("resolve_user")},
					{Action: "register", PivotPurpose: &pivot},
				},
			},
			{
				Name:   "resolve_user",
				Type:   domain.FlowStepTypePolicyCheck,
				Config: nil,
				Transitions: []domain.FlowStepTransition{
					{Action: "found", TargetStep: new("password")},
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