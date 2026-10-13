package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestDeploymentErrorResponseStatuses(t *testing.T) {
	cases := []struct {
		err    domain.Error
		status int
	}{
		{domain.ErrDeploymentNotFound(), http.StatusNotFound},
		{domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}), http.StatusConflict},
		{domain.ErrDeploymentInvalid("bad", nil), http.StatusBadRequest},
		{domain.ErrDeploymentPermissionDenied(), http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.err.Code, func(t *testing.T) {
			resp := deploymentErrorResponse(tc.err)
			assert.Equal(t, tc.status, resp.StatusCode)
		})
	}
}

// The 409 exists so the caller can retry on top of what actually runs, which
// only works if the conflict's payload survives into the response envelope.
func TestDeploymentConflictCarriesDetails(t *testing.T) {
	// Nothing deployed to the targets yet: the payload says so with a null
	// deployment rather than dropping the key.
	resp := deploymentErrorResponse(domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}))
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	// Producer-attached details ride the legacy details.details slot
	// (ADR 030).
	raw, ok := resp.Response.Details.Value["details"]
	require.True(t, ok, "conflict payload missing from details.details")
	assert.JSONEq(t, `{"deployment":null}`, string(raw))
}

// A conflict with a deployment renders it in the wire shape: snake_case keys
// and string enums.
func TestDeploymentConflictRendersTheDeployment(t *testing.T) {
	newest := &domain.Deployment{
		ProjectID:  "proj_1",
		ID:         "dep_1",
		ReleaseID:  "rel_1",
		TargetKind: domain.DeploymentTargetKindPrimary,
		Targets:    []domain.DeploymentTarget{{Origin: "https://app.acme.com"}},
		DeployedAt: time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC),
		Metadata: domain.DeploymentMetadata{
			Reason:         domain.DeploymentReasonRollback,
			RollbackTo:     new("dep_0"),
			DeployedByType: new(domain.EventActorTypeService),
		},
	}
	resp := deploymentErrorResponse(domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{Deployment: newest}))
	raw, ok := resp.Response.Details.Value["details"]
	require.True(t, ok)
	assert.JSONEq(t, `{"deployment":{
		"id":"dep_1","project_id":"proj_1","release_id":"rel_1",
		"targets":[{"origin":"https://app.acme.com"}],
		"deployed_at":"2026-10-02T14:52:00Z",
		"metadata":{"reason":"rollback","message":null,"rollback_to":"dep_0","deployed_by":null,"deployed_by_type":"service"}
	}}`, string(raw))
}

// Pins the deployment resource-flavored answers through the resolver gate,
// like TestReleaseAccessRow: a foreign-project write reports the project as
// missing and a read reports the deployment as missing, so neither confirms
// the other project exists.
func TestDeploymentAccessRow(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})

	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", deploymentAccess, opWrite))
	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", deploymentAccess, opRead))

	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", deploymentAccess, opWrite),
		domain.ErrEnvironmentProjectNotFound().Code)
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", deploymentAccess, opRead),
		domain.ErrDeploymentNotFound().Code)
}
