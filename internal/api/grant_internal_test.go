package api

import (
	"context"
	"errors"
	"testing"

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
