package api

import (
	"errors"
	"testing"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestMapQueryGrantsToService_Expand(t *testing.T) {
	tests := []struct {
		name     string
		expand   []api.GrantExpand
		wantIncl bool
	}{
		{"none", nil, false},
		{"principal", []api.GrantExpand{api.GrantExpandPrincipal}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := mapQueryGrantsToService("proj_a", &api.QueryGrantsRequest{Expand: tt.expand})
			if input.IncludePrincipal != tt.wantIncl {
				t.Fatalf("IncludePrincipal = %v, want %v", input.IncludePrincipal, tt.wantIncl)
			}
		})
	}
}

func TestGrantResponse_Principal(t *testing.T) {
	asgn := &domain.AuthzAssignment{
		ID:            "asgn_1",
		ProjectID:     "proj_a",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_1",
		ObjectType:    "project",
		Relation:      "viewer",
	}
	userRef := &domain.UserRef{UserID: "user_1"}

	t.Run("omit when Principal is nil", func(t *testing.T) {
		resp, err := grantResponse(&service.Grant{Assignment: asgn, User: userRef})
		if err != nil {
			t.Fatal(err)
		}
		if resp.Principal.IsSet() {
			t.Fatal("principal should be omitted")
		}
	})
	t.Run("null when Principal is empty", func(t *testing.T) {
		resp, err := grantResponse(&service.Grant{
			Assignment: asgn,
			User:       userRef,
			Principal:  &service.GrantPrincipal{},
		})
		if err != nil {
			t.Fatal(err)
		}
		if !resp.Principal.IsSet() || !resp.Principal.IsNull() {
			t.Fatalf("principal set=%v null=%v, want set+null", resp.Principal.IsSet(), resp.Principal.IsNull())
		}
	})
	t.Run("nil grant", func(t *testing.T) {
		_, err := grantResponse(nil)
		if !errors.Is(err, domain.ErrGrantNotFound()) {
			t.Fatalf("error = %v, want grant not found", err)
		}
	})
}
