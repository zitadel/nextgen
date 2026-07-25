//go:build spanner_integration

package spanner

import (
	"database/sql"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueFlowDefinitionID(t *testing.T) string {
	t.Helper()
	return "flow-" + strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
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

	connector, stop, err := dbtest.Spanner(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	cfg, ok := connector.(*spannerdialect.Config)
	require.True(t, ok)

	db, err := sql.Open("spanner", cfg.DSN)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, migration.Migrate(ctx, db))

	dialect, err := DecodeConfig(cfg.DSN)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(ctx) })

	client := pool.(*Client)
	stmts := client.Statements()

	project := &domain.Project{
		ID:             "proj_v2_flowdef",
		PreviewOrigins: []string{},
	}
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(ctx, project.ID) })

	def := sampleFlowDefinition(project.ID, uniqueFlowDefinitionID(t))
	require.NoError(t, stmts.CreateFlowDefinition(ctx, def))
	t.Cleanup(func() { _ = stmts.DeleteFlowDefinitionByID(ctx, project.ID, def.ID) })

	got, err := stmts.GetFlowDefinitionByID(ctx, project.ID, def.ID)
	require.NoError(t, err)
	assert.Equal(t, def.ID, got.ID)
	assert.Equal(t, def.Name, got.Name)
	assert.Equal(t, def.Status, got.Status)
	assert.Equal(t, def.UserSchema, got.UserSchema)
	assert.Equal(t, def.Purposes, got.Purposes)

	listed, err := stmts.ListFlowDefinitions(ctx, &v2database.ListOptions[domain.FlowDefinitionField]{
		Filter: v2database.And(
			v2database.Equal(v2database.Col(domain.FlowDefinitionFieldProjectID), project.ID),
			v2database.Equal(v2database.Col(domain.FlowDefinitionFieldPurposes), domain.FlowDefinitionPurposeLogin.String()),
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

	connector, stop, err := dbtest.Spanner(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	cfg, ok := connector.(*spannerdialect.Config)
	require.True(t, ok)

	db, err := sql.Open("spanner", cfg.DSN)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, migration.Migrate(ctx, db))

	dialect, err := DecodeConfig(cfg.DSN)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(ctx) })

	stmts := pool.(*Client).Statements()

	project := &domain.Project{
		ID:             "proj_v2_flowdef_cascade",
		PreviewOrigins: []string{},
	}
	require.NoError(t, stmts.CreateProject(ctx, project))

	def := sampleFlowDefinition(project.ID, uniqueFlowDefinitionID(t))
	require.NoError(t, stmts.CreateFlowDefinition(ctx, def))

	require.NoError(t, stmts.DeleteProjectByID(ctx, project.ID))

	_, err = stmts.GetFlowDefinitionByID(ctx, project.ID, def.ID)
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
