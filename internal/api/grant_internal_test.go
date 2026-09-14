package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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
			assert.Equal(t, tt.wantIncl, input.IncludePrincipal)
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
		require.NoError(t, err)
		assert.Equal(t, "user_1", got.UserID)
		assert.Empty(t, got.Identifier)
		assert.Empty(t, got.TeamID)
	})
	t.Run("user identifier", func(t *testing.T) {
		got, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationAdmin,
			User: api.NewOptUserLocator(api.UserLocator{
				Identifier: api.NewOptString("alice@acme.com"),
			}),
		})
		require.NoError(t, err)
		assert.Equal(t, "alice@acme.com", got.Identifier)
		assert.Empty(t, got.UserID)
	})
	t.Run("team id", func(t *testing.T) {
		got, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationEditor,
			Team: api.NewOptTeamLocator(api.TeamLocator{
				TeamID: api.NewOptTeamID("team_1"),
			}),
		})
		require.NoError(t, err)
		assert.Equal(t, "team_1", got.TeamID)
		assert.Empty(t, got.TeamName)
	})
	t.Run("team name", func(t *testing.T) {
		got, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationAdmin,
			Team: api.NewOptTeamLocator(api.TeamLocator{
				Name: api.NewOptString("Acme AI Admins"),
			}),
		})
		require.NoError(t, err)
		assert.Equal(t, "Acme AI Admins", got.TeamName)
		assert.Empty(t, got.TeamID)
	})
	t.Run("neither user nor team", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{Relation: api.CreateGrantRequestRelationViewer})
		require.ErrorIs(t, err, domain.ErrGrantInvalid())
	})
	t.Run("both user and team", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User:     api.NewOptUserLocator(api.UserLocator{UserID: api.NewOptUserID("user_1")}),
			Team:     api.NewOptTeamLocator(api.TeamLocator{TeamID: api.NewOptTeamID("team_1")}),
		})
		require.ErrorIs(t, err, domain.ErrGrantInvalid())
	})
	t.Run("user both fields", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User: api.NewOptUserLocator(api.UserLocator{
				UserID:     api.NewOptUserID("user_1"),
				Identifier: api.NewOptString("alice@acme.com"),
			}),
		})
		require.ErrorIs(t, err, domain.ErrGrantInvalid())
	})
	t.Run("team both fields", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			Team: api.NewOptTeamLocator(api.TeamLocator{
				TeamID: api.NewOptTeamID("team_1"),
				Name:   api.NewOptString("Acme AI Admins"),
			}),
		})
		require.ErrorIs(t, err, domain.ErrGrantInvalid())
	})
	t.Run("empty user locator", func(t *testing.T) {
		_, err := createGrantInput("proj_a", &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User:     api.NewOptUserLocator(api.UserLocator{}),
		})
		require.ErrorIs(t, err, domain.ErrGrantInvalid())
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
		require.NoError(t, err)
		require.True(t, resp.User.IsSet())
		assert.Equal(t, api.UserID("user_1"), resp.User.Value.UserID)
		assert.False(t, resp.User.Value.Schema.IsSet())
		assert.False(t, resp.Team.IsSet())
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
		require.NoError(t, err)
		require.True(t, resp.User.Value.Schema.IsSet())
		assert.Equal(t, "sch_1", resp.User.Value.Schema.Value)
	})
	t.Run("degraded ref when expand asked but user missing", func(t *testing.T) {
		resp, err := grantResponse(&service.Grant{
			Assignment: asgn,
			User:       &domain.UserRef{UserID: "user_1"},
			Principal:  &service.GrantPrincipal{},
		})
		require.NoError(t, err)
		assert.Equal(t, api.UserID("user_1"), resp.User.Value.UserID)
		assert.False(t, resp.User.Value.Schema.IsSet())
	})
	t.Run("nil grant", func(t *testing.T) {
		_, err := grantResponse(nil)
		require.ErrorIs(t, err, domain.ErrGrantNotFound())
	})
}
