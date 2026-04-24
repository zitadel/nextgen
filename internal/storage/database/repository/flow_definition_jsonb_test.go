package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestFlowDefinitionJSONBRepository_CreateAndGet(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionJSONBRepository{Client: tx}
	def := sampleFlowDefinition("inst-j1", "flow-j1")

	err := repo.CreateFlowDefinition(t.Context(), def)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), "inst-j1", "flow-j1")
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

func TestFlowDefinitionJSONBRepository_GetNotFound(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionJSONBRepository{Client: tx}

	_, err := repo.GetFlowDefinition(t.Context(), "inst-j-missing", "flow-j-missing")
	require.Error(t, err)
}

func TestFlowDefinitionJSONBRepository_List(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionJSONBRepository{Client: tx}

	for _, id := range []string{"flow-ja", "flow-jb", "flow-jc"} {
		def := sampleFlowDefinition("inst-jlist", id)
		if id == "flow-jb" {
			def.Status = domain.FlowDefinitionStatusActive
		}
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))
	}

	all, err := repo.ListFlowDefinitions(t.Context(), "inst-jlist")
	require.NoError(t, err)
	assert.Len(t, all, 3)

	active, err := repo.ListFlowDefinitions(t.Context(), "inst-jlist",
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive))
	require.NoError(t, err)
	require.Len(t, active, 1)
	assert.Equal(t, "flow-jb", active[0].ID)
}

func TestFlowDefinitionJSONBRepository_ListPagination(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionJSONBRepository{Client: tx}

	for _, id := range []string{"flow-jp1", "flow-jp2", "flow-jp3", "flow-jp4"} {
		require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("inst-jpage", id)))
	}

	page1, err := repo.ListFlowDefinitions(t.Context(), "inst-jpage",
		domain.WithFlowDefinitionLimit(2))
	require.NoError(t, err)
	assert.Len(t, page1, 2)

	page2, err := repo.ListFlowDefinitions(t.Context(), "inst-jpage",
		domain.WithFlowDefinitionLimit(2),
		domain.WithFlowDefinitionOffset(2))
	require.NoError(t, err)
	assert.Len(t, page2, 2)

	assert.NotEqual(t, page1[0].ID, page2[0].ID)
}

func TestFlowDefinitionJSONBRepository_UpdateStatus(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionJSONBRepository{Client: tx}
	def := sampleFlowDefinition("inst-jupd", "flow-jupd")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))

	err := repo.UpdateFlowDefinitionStatus(t.Context(), "inst-jupd", "flow-jupd", domain.FlowDefinitionStatusActive)
	require.NoError(t, err)

	got, err := repo.GetFlowDefinition(t.Context(), "inst-jupd", "flow-jupd")
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got.Status)
}

func TestFlowDefinitionJSONBRepository_Delete(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionJSONBRepository{Client: tx}
	def := sampleFlowDefinition("inst-jdel", "flow-jdel")
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), def))

	err := repo.DeleteFlowDefinition(t.Context(), "inst-jdel", "flow-jdel")
	require.NoError(t, err)

	_, err = repo.GetFlowDefinition(t.Context(), "inst-jdel", "flow-jdel")
	require.Error(t, err)
}

func TestFlowDefinitionJSONBRepository_InstanceIsolation(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := &repository.FlowDefinitionJSONBRepository{Client: tx}
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("inst-jA", "flow-j1")))
	require.NoError(t, repo.CreateFlowDefinition(t.Context(), sampleFlowDefinition("inst-jB", "flow-j1")))

	listA, err := repo.ListFlowDefinitions(t.Context(), "inst-jA")
	require.NoError(t, err)
	assert.Len(t, listA, 1)

	listB, err := repo.ListFlowDefinitions(t.Context(), "inst-jB")
	require.NoError(t, err)
	assert.Len(t, listB, 1)
}
