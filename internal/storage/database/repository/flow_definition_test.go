//go:build integration || spanner_integration

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

	repo := repository.NewFlowDefinitionRepository(tx)
	def := sampleFlowDefinition("proj-j1", "flow-j1")

	err := repo.CreateFlowDefinition(t.Context(), tx, def)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), tx, "proj-j1", "flow-j1")
	require.NoError(t, err)

	assert.Equal(t, def.ID, got.ID)
	assert.Equal(t, def.Name, got.Name)
	assert.Equal(t, def.SchemaVersion, got.SchemaVersion)
	assert.Equal(t, def.Status, got.Status)
	assert.Equal(t, def.UserSchema, got.UserSchema)
	assert.WithinDuration(t, time.Now(), got.CreatedAt, 5*time.Second)
	assert.WithinDuration(t, time.Now(), got.UpdatedAt, 5*time.Second)

	require.Len(t, got.Purposes, 1)
	assert.Equal(t, "identifier", got.Purposes[domain.FlowDefinitionPurposeLogin])

	assert.Equal(t, def.Audience.AppIDs, got.Audience.AppIDs)
	assert.Empty(t, got.Audience.TeamIDs)

	require.Len(t, got.Steps, 3)
	stepsByName := make(map[string]domain.FlowDefinitionStep)
	for _, s := range got.Steps {
		stepsByName[s.Name] = s
	}

	identifier := stepsByName["identifier"]
	assert.Equal(t, []string{"email"}, identifier.Fields)
	assert.Nil(t, identifier.OnSuccess)
	assert.Nil(t, identifier.Complete)
	require.Len(t, identifier.Transitions, 2)

	require.Contains(t, identifier.Actions, "submit")
	assert.Equal(t, "identifier.submit", identifier.Actions["submit"].TextKey)
	assert.True(t, identifier.Actions["submit"].Primary)

	require.Contains(t, identifier.Gates, "bot")
	bot := identifier.Gates["bot"]
	assert.Equal(t, domain.FlowGateKindCaptcha, bot.Kind)
	assert.Equal(t, "altcha", bot.Provider)
	assert.Equal(t, "abc", bot.Config["site_key"])

	require.Len(t, identifier.SSOProviders, 1)
	assert.Equal(t, "google-1", identifier.SSOProviders[0].ID)
	assert.Equal(t, "Google", identifier.SSOProviders[0].Name)
	assert.Equal(t, "google", identifier.SSOProviders[0].Template)

	var currentFlowTr domain.FlowStepTransition
	for _, tr := range identifier.Transitions {
		if tr.Action == nil {
			currentFlowTr = tr
		}
	}
	assert.Equal(t, "resolve_user", currentFlowTr.Target)
	assert.True(t, currentFlowTr.IsCurrentFlow())

	registerTr, ok := identifier.Transitions["register"]
	require.True(t, ok)
	require.NotNil(t, registerTr.Action)
	assert.Equal(t, domain.Pivot, *registerTr.Action)
	assert.Equal(t, "register-flow", registerTr.Target)
}

func TestFlowDefinitionRepository_GetNotFound(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)

	_, err := repo.GetFlowDefinition(t.Context(), tx, "proj-missing", "flow-missing")
	require.Error(t, err)
}

func TestFlowDefinitionRepository_List(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)

	for _, id := range []string{"flow-ja", "flow-jb", "flow-jc"} {
		def := sampleFlowDefinition("proj-jlist", id)
		if id == "flow-jb" {
			def.Status = domain.FlowDefinitionStatusActive
		}
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, def))
	}

	all, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jlist")
	require.NoError(t, err)
	assert.Len(t, all, 3)

	active, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jlist",
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive))
	require.NoError(t, err)
	require.Len(t, active, 1)
	assert.Equal(t, "flow-jb", active[0].ID)
}

func TestFlowDefinitionRepository_ListByPurpose(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)

	// flow-pa: serves login only (via sampleFlowDefinition)
	defA := sampleFlowDefinition("proj-jpurp", "flow-pa")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, defA))

	// flow-pb: serves both login and register
	defB := sampleFlowDefinition("proj-jpurp", "flow-pb")
	defB.Purposes[domain.FlowDefinitionPurposeRegister] = "start"
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, defB))

	loginOnly, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jpurp",
		domain.WithFlowDefinitionPurpose(domain.FlowDefinitionPurposeLogin))
	require.NoError(t, err)
	assert.Len(t, loginOnly, 2)

	registerOnly, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jpurp",
		domain.WithFlowDefinitionPurpose(domain.FlowDefinitionPurposeRegister))
	require.NoError(t, err)
	require.Len(t, registerOnly, 1)
	assert.Equal(t, "flow-pb", registerOnly[0].ID)
}

func TestFlowDefinitionRepository_ListBySchemaVersion(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)

	defA := sampleFlowDefinition("proj-jpurp", "flow-pa")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, defA))

	defB := sampleFlowDefinition("proj-jpurp", "flow-pb")
	defB.SchemaVersion = "1.2.3"
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, defB))

	res, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jpurp",
		domain.WithSchemaVersion("1.2.3"))
	require.NoError(t, err)
	require.Len(t, res, 1)

	assert.Equal(t, "flow-pb", res[0].ID)
}

func TestFlowDefinitionRepository_ListPagination(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)

	for _, id := range []string{"flow-jp1", "flow-jp2", "flow-jp3", "flow-jp4"} {
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, sampleFlowDefinition("proj-jpage", id)))
	}

	page1, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jpage",
		domain.WithFlowDefinitionLimit(2))
	require.NoError(t, err)
	assert.Len(t, page1, 2)

	page2, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jpage",
		domain.WithFlowDefinitionLimit(2),
		domain.WithFlowDefinitionOffset(2))
	require.NoError(t, err)
	assert.Len(t, page2, 2)

	assert.NotEqual(t, page1[0].ID, page2[0].ID)
}

func TestFlowDefinitionRepository_UpdateStatus(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)
	def := sampleFlowDefinition("proj-jupd", "flow-jupd")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, def))

	err := repo.UpdateFlowDefinitionStatus(t.Context(), tx, "proj-jupd", "flow-jupd", domain.FlowDefinitionStatusActive)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), tx, "proj-jupd", "flow-jupd")
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got.Status)
}

func TestFlowDefinitionRepository_Delete(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)
	def := sampleFlowDefinition("proj-jdel", "flow-jdel")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, def))

	err := repo.DeleteFlowDefinition(t.Context(), tx, "proj-jdel", "flow-jdel")
	require.NoError(t, err)

	_, err = repo.GetFlowDefinition(t.Context(), tx, "proj-jdel", "flow-jdel")
	require.Error(t, err)
}

func TestFlowDefinitionRepository_ProjectIsolation(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewFlowDefinitionRepository(tx)
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, sampleFlowDefinition("proj-jA", "flow-j1")))
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), tx, sampleFlowDefinition("proj-jB", "flow-j1")))

	listA, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jA")
	require.NoError(t, err)
	assert.Len(t, listA, 1)

	listB, err := repo.ListFlowDefinitions(t.Context(), tx, "proj-jB")
	require.NoError(t, err)
	assert.Len(t, listB, 1)
}

func sampleFlowDefinition(projectID, id string) *domain.FlowDefinition {
	pivotAction := domain.Pivot
	createUser := domain.FlowOnSuccessCreateUser
	completeShow := domain.FlowStepCompleteShow
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
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {TextKey: "identifier.submit", Primary: true},
				},
				Gates: map[string]domain.FlowStepGate{
					"bot": {
						Kind:     domain.FlowGateKindCaptcha,
						Provider: "altcha",
						Config:   map[string]any{"site_key": "abc"},
					},
				},
				SSOProviders: []domain.FlowSSOProvider{
					{ID: "google-1", Name: "Google", Template: "google"},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit":   {Target: "resolve_user"},
					"register": {Action: &pivotAction, Target: "register-flow"},
				},
			},
			{
				Name: "resolve_user",
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "password"},
				},
			},
			{
				Name:        "password",
				Fields:      []string{"password"},
				OnSuccess:   &createUser,
				Complete:    &completeShow,
				Transitions: map[string]domain.FlowStepTransition{},
			},
		},
	}
}
