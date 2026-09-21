//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	policystore "github.com/zitadel/nextgen/internal/storage/policy"
)

func uniquePolicyIDs(t *testing.T) (projectID, policyID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-pol-" + suffix, "pol-" + suffix
}

func ensurePolicyProject(t *testing.T, stmts service.AllStatements, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })
}

func samplePolicy(projectID, id string) *domain.Policy {
	return &domain.Policy{
		ProjectID:   projectID,
		ID:          id,
		Operation:   "user.password.save",
		Audience:    policy.Audience{TeamIDs: []string{"team_acme"}},
		Enforcement: policy.EnforcementAudit,
		Config:      map[string]any{"min_length": float64(20), "history_depth": float64(2)},
	}
}

func TestPolicyStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, policyID := uniquePolicyIDs(t)
		ensurePolicyProject(t, d.stmts, projectID)

		entity := samplePolicy(projectID, policyID)
		require.NoError(t, d.stmts.CreatePolicy(t.Context(), entity))
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)

		got, err := d.stmts.GetPolicyByID(t.Context(), projectID, policyID)
		require.NoError(t, err)
		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, entity.Operation, got.Operation)
		assert.Equal(t, entity.Audience, got.Audience)
		assert.Equal(t, entity.Enforcement, got.Enforcement)
		assert.Equal(t, entity.Config, got.Config)
	})
}

func TestPolicyStatements_Create_EmptyIDAssigned(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniquePolicyIDs(t)
		ensurePolicyProject(t, d.stmts, projectID)

		entity := samplePolicy(projectID, "")
		require.NoError(t, d.stmts.CreatePolicy(t.Context(), entity))
		require.NotEmpty(t, entity.ID)
		assert.True(t, strings.HasPrefix(entity.ID, string(domain.PrefixPolicy)+"_"))
	})
}

func TestPolicyStatements_ListNewestFirstPerOperation(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniquePolicyIDs(t)
		ensurePolicyProject(t, d.stmts, projectID)

		first := samplePolicy(projectID, "pol-001")
		require.NoError(t, d.stmts.CreatePolicy(t.Context(), first))
		second := samplePolicy(projectID, "pol-002")
		second.Config["min_length"] = float64(25)
		require.NoError(t, d.stmts.CreatePolicy(t.Context(), second))
		other := samplePolicy(projectID, "pol-003")
		other.Operation = "user.password.verify"
		require.NoError(t, d.stmts.CreatePolicy(t.Context(), other))

		got, err := d.stmts.ListPolicies(unfilteredListCtx(t), policystore.ListOperationOptions(projectID, "user.password.save", 0))
		require.NoError(t, err)
		require.Len(t, got.Items, 2)
		assert.Equal(t, "pol-002", got.Items[0].ID)
		assert.Equal(t, float64(25), got.Items[0].Config["min_length"])
		assert.Equal(t, "pol-001", got.Items[1].ID)

		all, err := d.stmts.ListPolicies(unfilteredListCtx(t), policystore.ListOptions(projectID, 0))
		require.NoError(t, err)
		require.Len(t, all.Items, 3)
	})
}

func TestPolicyStatements_Get_NotFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, policyID := uniquePolicyIDs(t)
		ensurePolicyProject(t, d.stmts, projectID)

		_, err := d.stmts.GetPolicyByID(t.Context(), projectID, policyID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
