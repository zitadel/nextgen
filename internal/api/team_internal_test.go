package api

import (
	"context"
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

// Without project_id the list addresses the credential's home project, and
// the list gate checks whichever project is listed before any row is read.
func TestQueryTeams_ProjectScope(t *testing.T) {
	for _, caller := range []ScopeContext{
		{
			ProjectID:     "proj_home",
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   "user_alice",
		},
		{
			ProjectID:     "proj_home",
			Scope:         []string{"project.write"},
			PrincipalType: domain.AuthzPrincipalTypeSKProj,
			PrincipalID:   "proj_home",
		},
	} {
		t.Run(string(caller.PrincipalType), func(t *testing.T) {
			for _, tt := range []struct {
				name        string
				projectID   api.OptProjectID
				wantProject string
				allowed     bool
			}{
				{"defaults to credential home", api.OptProjectID{}, "proj_home", true},
				{"names the home project", api.NewOptProjectID("proj_home"), "proj_home", true},
				{"names another project", api.NewOptProjectID("proj_target"), "proj_target", true},
				{"home without access", api.OptProjectID{}, "proj_home", false},
			} {
				t.Run(tt.name, func(t *testing.T) {
					ctrl := gomock.NewController(t)
					pool := servicemocks.NewMockPool(ctrl)
					stmts := servicemocks.NewMockAllStatements(ctrl)
					pool.EXPECT().Statements().Return(stmts).AnyTimes()
					stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
					check := stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).DoAndReturn(
						func(_ context.Context, params domain.AuthzCheckParams) (bool, bool, error) {
							assert.Equal(t, tt.wantProject, params.ProjectID)
							return tt.allowed, tt.allowed, nil
						},
					)
					if tt.allowed {
						stmts.EXPECT().ListTeams(gomock.Any(), gomock.Any()).After(check.Call).DoAndReturn(
							func(_ context.Context, opts *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
								filter, ok := opts.Filter.(database.AndFilter[domain.TeamField])
								require.True(t, ok, "filter is %T", opts.Filter)
								assert.Contains(t, filter.Filters, database.Equal(database.Col(domain.TeamFieldProjectID), tt.wantProject))
								return &database.ListResult[*domain.Team]{}, nil
							},
						)
					}
					db := service.NewPool(pool)
					h := Handler{pool: db, teamService: service.NewTeamService(db)}

					resp, err := h.QueryTeams(WithScopeContext(t.Context(), caller), &api.QueryTeamsRequest{},
						api.QueryTeamsParams{ProjectID: tt.projectID})
					if !tt.allowed {
						assertDomainCode(t, err, domain.ErrTeamNotFound().Code)
						return
					}
					require.NoError(t, err)
					require.IsType(t, &api.QueryTeamsResponse{}, resp)
				})
			}
		})
	}
}

// The contract only knows active and deactivated, so every other domain status
// has to collapse onto one of them.
func TestTeamStatus(t *testing.T) {
	tests := []struct {
		status domain.TeamStatus
		want   api.TeamStatus
	}{
		{domain.TeamStatusActive, api.TeamStatusActive},
		{domain.TeamStatusDeactivated, api.TeamStatusDeactivated},
		{domain.TeamStatusPendingPurge, api.TeamStatusDeactivated},
	}
	for _, tt := range tests {
		t.Run(tt.status.String(), func(t *testing.T) {
			if got := teamStatus(tt.status); got != tt.want {
				t.Fatalf("teamStatus(%q) = %q, want %q", tt.status, got, tt.want)
			}
		})
	}
}
