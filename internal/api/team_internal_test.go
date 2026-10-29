package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
				query       string
				wantProject string
				allowed     bool
			}{
				{"defaults to credential home", "", "proj_home", true},
				{"explicit home", "?project_id=proj_home", "proj_home", true},
				{"explicit target", "?project_id=proj_target", "proj_target", caller.PrincipalType == domain.AuthzPrincipalTypeUser},
				{"home without access", "", "proj_home", false},
				{"target without access", "?project_id=proj_target", "proj_target", false},
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
							assert.Equal(t, caller.ProjectID, params.PrincipalHomeProjectID)
							assert.Equal(t, caller.PrincipalID, params.PrincipalID)
							return tt.allowed, tt.allowed, nil
						},
					)
					if tt.allowed {
						stmts.EXPECT().ListTeams(gomock.Any(), gomock.Any()).After(check.Call).DoAndReturn(
							func(_ context.Context, opts *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
								assert.Equal(t, database.And(
									database.Equal(database.Col(domain.TeamFieldProjectID), tt.wantProject),
									database.Or(
										database.Equal(database.Col(domain.TeamFieldStatus), "active"),
										database.Equal(database.Col(domain.TeamFieldStatus), "deactivated"),
									),
								), opts.Filter)
								return &database.ListResult[*domain.Team]{Items: []*domain.Team{{
									ID: "team_1", ProjectID: tt.wantProject, Status: domain.TeamStatusActive,
								}}}, nil
							},
						)
					}
					db := service.NewPool(pool)
					h := Handler{pool: db, teamService: service.NewTeamService(db)}
					token := &domain.Token{ProjectID: caller.ProjectID, Scope: caller.Scope, Type: domain.TokenTypeProjectToken}
					req := httptest.NewRequest(http.MethodPost, "/teams/query"+tt.query, strings.NewReader(`{}`))
					req.Header.Set("Content-Type", "application/json")
					if caller.PrincipalType == domain.AuthzPrincipalTypeUser {
						token.Type = domain.TokenTypeSessionToken
						token.UserID = caller.PrincipalID
						token.SessionID = new("sess_1")
						token.TokenID = "tkn_1"
						req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "credential"})
					} else {
						req.Header.Set("Authorization", "Bearer credential")
					}
					tokens := servicemocks.NewMockTokenService(ctrl)
					tokens.EXPECT().IntrospectToken(gomock.Any(), "credential").Return(token, nil)
					srv, err := api.NewServer(&h, NewSecurityHandler(tokens), api.WithErrorHandler(OgenErrorHandler))
					require.NoError(t, err)
					rec := httptest.NewRecorder()
					WithCSRFRequest(srv).ServeHTTP(rec, req)
					if !tt.allowed {
						require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
						var body api.ErrorDetails
						require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
						assert.Equal(t, domain.ErrTeamNotFound().Code, string(body.Code))
						return
					}
					require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
					var body api.QueryTeamsResponse
					require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
					require.Len(t, body.Teams, 1)
					assert.Equal(t, "team_1", body.Teams[0].ID)
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
