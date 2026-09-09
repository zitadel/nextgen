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

func TestCreateGrantInput_Locators(t *testing.T) {
	t.Run("user id", func(t *testing.T) {
		got, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User: api.NewOptUserLocator(api.UserLocator{
				UserID: api.NewOptUserID("user_1"),
			}),
		})
		if err != nil {
			t.Fatal(err)
		}
		if got.UserID != "user_1" || got.Identifier != "" || got.TeamID != "" {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("user identifier", func(t *testing.T) {
		got, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationAdmin,
			User: api.NewOptUserLocator(api.UserLocator{
				Identifier: api.NewOptString("alice@acme.com"),
			}),
		})
		if err != nil {
			t.Fatal(err)
		}
		if got.Identifier != "alice@acme.com" || got.UserID != "" {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("team id", func(t *testing.T) {
		got, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationEditor,
			Team: api.NewOptTeamLocator(api.TeamLocator{
				TeamID: api.NewOptTeamID("team_1"),
			}),
		})
		if err != nil {
			t.Fatal(err)
		}
		if got.TeamID != "team_1" || got.TeamName != "" {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("team name", func(t *testing.T) {
		got, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationAdmin,
			Team: api.NewOptTeamLocator(api.TeamLocator{
				Name: api.NewOptString("Acme AI Admins"),
			}),
		})
		if err != nil {
			t.Fatal(err)
		}
		if got.TeamName != "Acme AI Admins" || got.TeamID != "" {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("neither user nor team", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{Relation: api.CreateGrantRequestRelationViewer})
		if !errors.Is(err, domain.ErrGrantInvalid()) {
			t.Fatalf("error = %v, want grant.invalid", err)
		}
	})
	t.Run("both user and team", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User:     api.NewOptUserLocator(api.UserLocator{UserID: api.NewOptUserID("user_1")}),
			Team:     api.NewOptTeamLocator(api.TeamLocator{TeamID: api.NewOptTeamID("team_1")}),
		})
		if !errors.Is(err, domain.ErrGrantInvalid()) {
			t.Fatalf("error = %v, want grant.invalid", err)
		}
	})
	t.Run("user both fields", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User: api.NewOptUserLocator(api.UserLocator{
				UserID:     api.NewOptUserID("user_1"),
				Identifier: api.NewOptString("alice@acme.com"),
			}),
		})
		if !errors.Is(err, domain.ErrGrantInvalid()) {
			t.Fatalf("error = %v, want grant.invalid", err)
		}
	})
	t.Run("team both fields", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			Team: api.NewOptTeamLocator(api.TeamLocator{
				TeamID: api.NewOptTeamID("team_1"),
				Name:   api.NewOptString("Acme AI Admins"),
			}),
		})
		if !errors.Is(err, domain.ErrGrantInvalid()) {
			t.Fatalf("error = %v, want grant.invalid", err)
		}
	})
	t.Run("empty user locator", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User:     api.NewOptUserLocator(api.UserLocator{}),
		})
		if !errors.Is(err, domain.ErrGrantInvalid()) {
			t.Fatalf("error = %v, want grant.invalid", err)
		}
	})
}

func TestGrantResponse_UserAndTeam(t *testing.T) {
	asgn := &domain.AuthzAssignment{
		ID:            "asgn_1",
		ProjectID:     "proj_a",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_1",
		ObjectType:    "project",
		Relation:      "viewer",
	}
	userRef := &domain.UserRef{UserID: "user_1", Identifier: "alice@acme.com", IdentifierProperty: "email"}

	t.Run("ref only when Principal is nil", func(t *testing.T) {
		resp, err := grantResponse(&service.Grant{Assignment: asgn, User: userRef})
		if err != nil {
			t.Fatal(err)
		}
		if !resp.User.IsSet() {
			t.Fatal("user should be set")
		}
		if resp.User.Value.UserID != "user_1" {
			t.Fatalf("user_id = %s", resp.User.Value.UserID)
		}
		if resp.User.Value.Schema.IsSet() {
			t.Fatal("schema should be omitted without expand")
		}
		if resp.Team.IsSet() {
			t.Fatal("team should be omitted on a user grant")
		}
	})
	t.Run("expand extras on user when Principal is loaded", func(t *testing.T) {
		resp, err := grantResponse(&service.Grant{
			Assignment: asgn,
			User:       userRef,
			Principal: &service.GrantPrincipal{
				User: &domain.User{
					ID:        "user_1",
					SchemaURL: "sch_1",
					Metadata:  domain.UserMetadata{Status: domain.UserStatusActive},
				},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if !resp.User.Value.Schema.IsSet() || resp.User.Value.Schema.Value != "sch_1" {
			t.Fatalf("schema = %+v", resp.User.Value.Schema)
		}
	})
	t.Run("degraded ref when expand asked but user missing", func(t *testing.T) {
		resp, err := grantResponse(&service.Grant{
			Assignment: asgn,
			User:       &domain.UserRef{UserID: "user_1"},
			Principal:  &service.GrantPrincipal{},
		})
		if err != nil {
			t.Fatal(err)
		}
		if resp.User.Value.UserID != "user_1" {
			t.Fatalf("user_id = %s", resp.User.Value.UserID)
		}
		if resp.User.Value.Schema.IsSet() {
			t.Fatal("schema should stay off a degraded ref")
		}
	})
	t.Run("nil grant", func(t *testing.T) {
		_, err := grantResponse(nil)
		if !errors.Is(err, domain.ErrGrantNotFound()) {
			t.Fatalf("error = %v, want grant not found", err)
		}
	})
}
