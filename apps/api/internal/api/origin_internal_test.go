package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestOriginErrorResponseStatuses(t *testing.T) {
	cases := []struct {
		err    domain.Error
		status int
	}{
		{domain.ErrOriginNotFound(), http.StatusNotFound},
		{domain.ErrOriginPermissionDenied(), http.StatusForbidden},
		{domain.ErrOriginInvalid(), http.StatusBadRequest},
		{domain.ErrOriginPrimaryNotExact(), http.StatusBadRequest},
		{domain.ErrOriginUnbounded(), http.StatusBadRequest},
		{domain.ErrOriginKindConflict(), http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.err.Code, func(t *testing.T) {
			resp := originErrorResponse(tc.err)
			assert.Equal(t, tc.status, resp.StatusCode)
		})
	}
}

// Pins the origin resource-flavored answers through the resolver gate, like
// TestDeploymentAccessRow: a foreign-project write reports the origin as
// missing and a denied credential gets permission_denied.
func TestOriginAccessRow(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})

	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", originAccess, opWrite))
	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", originAccess, opDelete))

	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", originAccess, opWrite),
		domain.ErrOriginNotFound().Code)
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", originAccess, opDelete),
		domain.ErrOriginNotFound().Code)
}
