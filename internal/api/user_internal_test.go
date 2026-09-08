package api

import (
	"context"
	"errors"
	"strings"
	"testing"

	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

// The membership gate on POST /users/query keys off this, so a field that reads
// like a team but is not a membership must not trip it: lifecycle_owner_team_id
// is a column on the user and carries no membership read (ADR 024).
func TestFiltersOnTeamID(t *testing.T) {
	filter := func(fields ...api.UserFilterField) []api.QueryUsersRequestFilterItem {
		items := make([]api.QueryUsersRequestFilterItem, 0, len(fields))
		for _, field := range fields {
			items = append(items, api.QueryUsersRequestFilterItem{Field: field})
		}
		return items
	}

	tests := []struct {
		name    string
		filters []api.QueryUsersRequestFilterItem
		want    bool
	}{
		{"no filters", nil, false},
		{"unrelated field", filter(api.UserFilterFieldStatus), false},
		{"lifecycle owner is not membership", filter(api.UserFilterFieldLifecycleOwnerTeamID), false},
		{"team id", filter(api.UserFilterFieldTeamID), true},
		{"team id among others", filter(api.UserFilterFieldStatus, api.UserFilterFieldTeamID), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := filtersOnTeamID(tt.filters); got != tt.want {
				t.Fatalf("filtersOnTeamID() = %v, want %v", got, tt.want)
			}
		})
	}
}

// Each expand value drives its own gate and its own storage option, so the two
// must not bleed into each other.
func TestMapQueryUsersToService_Expand(t *testing.T) {
	tests := []struct {
		name          string
		expand        []api.UserExpand
		wantTeams     bool
		wantOwnerTeam bool
	}{
		{"none", nil, false, false},
		{"teams", []api.UserExpand{api.UserExpandTeams}, true, false},
		{"owner team", []api.UserExpand{api.UserExpandLifecycleOwnerTeam}, false, true},
		{"both", []api.UserExpand{api.UserExpandTeams, api.UserExpandLifecycleOwnerTeam}, true, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := mapQueryUsersToService("proj_a", &api.QueryUsersRequest{Expand: tt.expand})
			if input.IncludeTeams != tt.wantTeams {
				t.Fatalf("IncludeTeams = %v, want %v", input.IncludeTeams, tt.wantTeams)
			}
			if input.IncludeLifecycleOwnerTeam != tt.wantOwnerTeam {
				t.Fatalf("IncludeLifecycleOwnerTeam = %v, want %v", input.IncludeLifecycleOwnerTeam, tt.wantOwnerTeam)
			}
		})
	}
}

func TestQueryUsers_SessionCaller(t *testing.T) {
	userCtx := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_home",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
	})

	t.Run("lists credential home", func(t *testing.T) {
		users := &stubQueryUsersService{}
		h := queryUsersHandler(t, true, true, users)
		resp, err := h.QueryUsers(userCtx, &api.QueryUsersRequest{})
		if err != nil {
			t.Fatalf("session list: %v", err)
		}
		if _, ok := resp.(*api.QueryUsersResponse); !ok {
			t.Fatalf("got %T, want QueryUsersResponse", resp)
		}
		if len(users.listProjectIDs) != 1 || users.listProjectIDs[0] != "proj_home" {
			t.Fatalf("ListUsers projects = %v, want [proj_home]", users.listProjectIDs)
		}
	})

	t.Run("no foothold is not found", func(t *testing.T) {
		users := &stubQueryUsersService{}
		h := queryUsersHandler(t, false, false, users)
		_, err := h.QueryUsers(userCtx, &api.QueryUsersRequest{})
		assertDomainCode(t, err, domain.ErrUserNotFound().Code)
		if len(users.listProjectIDs) != 0 {
			t.Fatalf("ListUsers must not run before Check, got %v", users.listProjectIDs)
		}
	})

	t.Run("expand and membership filter still need read scopes", func(t *testing.T) {
		tests := []struct {
			name string
			req  *api.QueryUsersRequest
			want string
		}{
			{
				name: "expand teams",
				req:  &api.QueryUsersRequest{Expand: []api.UserExpand{api.UserExpandTeams}},
				want: "team_membership.read",
			},
			{
				name: "team_id filter",
				req: &api.QueryUsersRequest{Filter: []api.QueryUsersRequestFilterItem{{
					Field: api.UserFilterFieldTeamID,
				}}},
				want: "team_membership.read",
			},
			{
				name: "expand owner team",
				req:  &api.QueryUsersRequest{Expand: []api.UserExpand{api.UserExpandLifecycleOwnerTeam}},
				want: "team.read",
			},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				users := &stubQueryUsersService{}
				h := queryUsersHandler(t, true, true, users)
				_, err := h.QueryUsers(userCtx, tt.req)
				assertDomainCode(t, err, domain.ErrUserPermissionDenied().Code)
				var de domain.Error
				if !errors.As(err, &de) {
					t.Fatalf("error is not a domain.Error: %v", err)
				}
				if !strings.Contains(de.Message, tt.want) {
					t.Fatalf("message %q does not name %q", de.Message, tt.want)
				}
				if len(users.listProjectIDs) != 0 {
					t.Fatalf("ListUsers must not run after expand/filter deny, got %v", users.listProjectIDs)
				}
			})
		}
	})
}

func queryUsersHandler(t *testing.T, allowed, foothold bool, users *stubQueryUsersService) Handler {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil).AnyTimes()
	stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(allowed, foothold, nil).AnyTimes()
	if users == nil {
		users = &stubQueryUsersService{}
	}
	return Handler{
		pool:        service.NewPool(pool),
		userService: users,
	}
}

type stubQueryUsersService struct {
	listProjectIDs []string
}

func (s *stubQueryUsersService) ApplyActions(context.Context, ...service.UserAction) error {
	return errors.New("unexpected ApplyActions")
}
func (s *stubQueryUsersService) CreateUser(context.Context, service.CreateUserInput) (*domain.User, error) {
	return nil, errors.New("unexpected CreateUser")
}
func (s *stubQueryUsersService) DeleteUser(context.Context, service.DeleteUserInput) error {
	return errors.New("unexpected DeleteUser")
}
func (s *stubQueryUsersService) ListUsers(_ context.Context, input service.ListUsersInput) (*service.ListUsersOutput, error) {
	s.listProjectIDs = append(s.listProjectIDs, input.ProjectID)
	return &service.ListUsersOutput{}, nil
}
func (s *stubQueryUsersService) ListPasskeys(context.Context, service.ListPasskeysInput) ([]*domain.UserPasskey, string, error) {
	return nil, "", errors.New("unexpected ListPasskeys")
}
func (s *stubQueryUsersService) ListUserTeams(context.Context, service.ListUserTeamsInput) (*service.ListUserTeamsOutput, error) {
	return nil, errors.New("unexpected ListUserTeams")
}
func (s *stubQueryUsersService) GetUserByID(context.Context, service.GetUserInput) (*domain.User, error) {
	return nil, errors.New("unexpected GetUserByID")
}
func (s *stubQueryUsersService) SetPassword(context.Context, service.SetPasswordInput) error {
	return errors.New("unexpected SetPassword")
}
func (s *stubQueryUsersService) GetMyUser(context.Context, service.GetMyUserInput) (*domain.User, error) {
	return nil, errors.New("unexpected GetMyUser")
}

var _ service.UserService = (*stubQueryUsersService)(nil)
