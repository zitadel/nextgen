package api

import (
	"context"
	"net/http"
	"testing"

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
	details := domain.DeploymentConflictDetails{
		CurrentDeploymentID: "dep_current",
		CurrentReleaseID:    "rel_current",
	}
	resp := deploymentErrorResponse(domain.ErrDeploymentConflict(details))
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	// Producer-attached details ride the legacy details.details slot
	// (ADR 030).
	raw, ok := resp.Response.Details.Value["details"]
	require.True(t, ok, "conflict payload missing from details.details")
	assert.JSONEq(t,
		`{"current_deployment_id":"dep_current","current_release_id":"rel_current"}`,
		string(raw))
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
