package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
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

func TestGrantCallerUserID(t *testing.T) {
	t.Parallel()

	t.Run("user session copies principal id", func(t *testing.T) {
		ctx := WithScopeContext(t.Context(), ScopeContext{
			ProjectID:     "proj_platform",
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   "user_alice",
		})
		assert.Equal(t, "user_alice", grantCallerUserID(ctx))
	})
	t.Run("project secret is empty", func(t *testing.T) {
		ctx := WithScopeContext(t.Context(), ScopeContext{
			ProjectID:     "proj_customer",
			PrincipalType: domain.AuthzPrincipalTypeSKProj,
			PrincipalID:   "proj_customer",
		})
		assert.Empty(t, grantCallerUserID(ctx))
	})
	t.Run("missing scope is empty", func(t *testing.T) {
		assert.Empty(t, grantCallerUserID(t.Context()))
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

func TestGrantErrorResponse(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  domain.Error
		want int
	}{
		{"invalid", domain.ErrGrantInvalid(), http.StatusBadRequest},
		{"not_found", domain.ErrGrantNotFound(), http.StatusNotFound},
		{"principal_not_found", domain.ErrGrantPrincipalNotFound(), http.StatusNotFound},
		{"already_exists", domain.ErrGrantAlreadyExists(), http.StatusConflict},
		{"permission_denied", domain.ErrGrantPermissionDenied(), http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := grantErrorResponse(tt.err); got.StatusCode != tt.want {
				t.Fatalf("grantErrorResponse(%q) status = %d, want %d", tt.err.Code, got.StatusCode, tt.want)
			}
		})
	}
}

func TestQueryGrants_PrincipalExpandCeiling(t *testing.T) {
	params := api.QueryGrantsParams{ProjectID: api.ProjectID("proj_customer")}
	expand := &api.QueryGrantsRequest{Expand: []api.GrantExpand{api.GrantExpandPrincipal}}
	userCtx := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_platform",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
	})
	secretCtx := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_customer",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_customer",
	})

	t.Run("session user without read scopes may expand", func(t *testing.T) {
		h := queryGrantsHandler(t, true, true, true)
		resp, err := h.QueryGrants(userCtx, expand, params)
		if err != nil {
			t.Fatalf("user expand: %v", err)
		}
		if _, ok := resp.(*api.QueryGrantsResponse); !ok {
			t.Fatalf("got %T, want QueryGrantsResponse", resp)
		}
	})

	t.Run("operator secret may expand via project.write", func(t *testing.T) {
		h := queryGrantsHandler(t, true, true, true)
		resp, err := h.QueryGrants(secretCtx, expand, params)
		if err != nil {
			t.Fatalf("secret expand: %v", err)
		}
		if _, ok := resp.(*api.QueryGrantsResponse); !ok {
			t.Fatalf("got %T, want QueryGrantsResponse", resp)
		}
	})

	t.Run("session user still needs Check before expand skip", func(t *testing.T) {
		h := queryGrantsHandler(t, false, true, false)
		_, err := h.QueryGrants(userCtx, expand, params)
		assertDomainCode(t, err, domain.ErrGrantPermissionDenied().Code)
	})

	t.Run("session user without foothold is not found", func(t *testing.T) {
		h := queryGrantsHandler(t, false, false, false)
		_, err := h.QueryGrants(userCtx, expand, params)
		assertDomainCode(t, err, domain.ErrGrantNotFound().Code)
	})
}

func queryGrantsHandler(t *testing.T, allowed, foothold, expectList bool) Handler {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil).AnyTimes()
	stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(allowed, foothold, nil).AnyTimes()
	if expectList {
		stmts.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any(), gomock.Any()).Return(
			&database.ListResult[*domain.AuthzAssignment]{}, nil)
	}
	db := service.NewPool(pool)
	return Handler{
		pool:         db,
		grantService: service.NewGrantService(db, nil, "proj_platform"),
	}
}
