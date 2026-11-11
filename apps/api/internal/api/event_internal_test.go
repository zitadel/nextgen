package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
)

// Pins the events resource-flavored answers through the resolver gate.
func TestEventsAccessRow(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})

	if err := requireProjectAccess(operator, stmts, "proj_a", eventsAccess, opRead); err != nil {
		t.Fatalf("own-project read with the project secret should pass: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", eventsAccess, opRead),
		domain.ErrEventNotFound().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", eventsAccess, opRead),
		domain.ErrEventPermissionDenied().Code)
}

// The events gate's question about an unclaimed project (ADR 049 §4) reads
// only for a session homed in the platform project, and marks an operator's
// read on the request's events (ADR 075 §5).
func TestEventsPlatformOperator(t *testing.T) {
	t.Parallel()

	request := func(t *testing.T, scope ScopeContext) context.Context {
		t.Helper()
		return WithScopeContext(audit.WithActorSlot(t.Context()), scope)
	}

	t.Run("an operator is one, and the read is marked", func(t *testing.T) {
		t.Parallel()
		h, _ := operatorHandler(t, new(true))
		ctx := request(t, operatorScope)

		operator, err := h.eventsPlatformOperator(ctx)
		require.NoError(t, err)
		assert.True(t, operator)
		assert.NotNil(t, audit.AuthorizationFromContext(ctx))
	})

	t.Run("a platform user who is no operator is not", func(t *testing.T) {
		t.Parallel()
		h, _ := operatorHandler(t, new(false))
		ctx := request(t, operatorScope)

		operator, err := h.eventsPlatformOperator(ctx)
		require.NoError(t, err)
		assert.False(t, operator)
		assert.Nil(t, audit.AuthorizationFromContext(ctx))
	})

	homedElsewhere := operatorScope
	homedElsewhere.ProjectID, homedElsewhere.PlatformProjectID = "proj_customer", ""
	noPlatformProject := operatorScope
	noPlatformProject.PlatformProjectID = ""
	for name, scope := range map[string]ScopeContext{
		"the project's own secret": {
			ProjectID:     "proj_customer",
			Scope:         []string{"project.write", "project.read"},
			PrincipalType: domain.AuthzPrincipalTypeSKProj,
			PrincipalID:   "proj_customer",
		},
		"a session homed elsewhere":                  homedElsewhere,
		"a session where no platform project is set": noPlatformProject,
	} {
		t.Run(name+" is not, without a read", func(t *testing.T) {
			t.Parallel()
			h, _ := operatorHandler(t, nil)

			operator, err := h.eventsPlatformOperator(request(t, scope))
			require.NoError(t, err)
			assert.False(t, operator)
		})
	}
}
