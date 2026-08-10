package api

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestEventsAccessRow(t *testing.T) {
	scopeCases := []struct {
		name  string
		op    accessOp
		scope string
		want  bool
	}{
		{"events.read reads", opRead, "events.read", true},
		{"preview secret grants nothing", opRead, "project.read", false},
	}
	for _, tt := range scopeCases {
		t.Run(tt.name, func(t *testing.T) {
			if got := scopeAllowed([]string{tt.scope}, eventsAccess.scopes[tt.op]); got != tt.want {
				t.Fatalf("scopeAllowed(%q, %v) = %v, want %v", tt.scope, tt.op, got, tt.want)
			}
		})
	}

	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.write", "project.read"},
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.read"},
	})
	eventsReader := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"events.read"},
	})

	if err := requireProjectAccess(operator, "proj_a", eventsAccess, opRead); err != nil {
		t.Fatalf("own-project read with project.write umbrella should pass: %v", err)
	}
	if err := requireProjectAccess(eventsReader, "proj_a", eventsAccess, opRead); err != nil {
		t.Fatalf("own-project read with events.read should pass: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(operator, "proj_b", eventsAccess, opRead),
		domain.ErrEventNotFound().Code)
	assertDomainCode(t, requireProjectAccess(preview, "proj_a", eventsAccess, opRead),
		domain.ErrEventPermissionDenied().Code)
}
