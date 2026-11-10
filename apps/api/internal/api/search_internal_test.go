package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Search reads a type through that type's list, behind one gate per read. The
// mock refuses any statement a case does not expect, so a case that names its
// reads also proves nothing else was read: no user is listed for a search
// that asks for teams.
func TestSearch_Teams(t *testing.T) {
	caller := ScopeContext{
		ProjectID:     "proj_home",
		Scope:         []string{"project.write"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_home",
	}
	team := func(id, name string) *domain.Team {
		return &domain.Team{ID: id, ProjectID: "proj_home", Name: name}
	}
	nameContains := func(text string) database.Filter[domain.TeamField] {
		return database.StringContainsFold(database.Col(domain.TeamFieldName), text)
	}
	idEquals := func(id string) database.Filter[domain.TeamField] {
		return database.StringEqual(database.Col(domain.TeamFieldID), id)
	}
	type read struct {
		filter database.Filter[domain.TeamField]
		result database.ListResult[*domain.Team]
	}

	for _, tt := range []struct {
		name  string
		query string
		limit api.OptInt
		// reads are the team lists the search makes, in order.
		reads          []read
		wantIDs        []string
		wantIncomplete []api.SearchResultType
	}{
		{
			name:  "ranks the matches of the trimmed text",
			query: "  pay ",
			reads: []read{{
				filter: nameContains("pay"),
				result: database.ListResult[*domain.Team]{Items: []*domain.Team{
					team("team_2", "Prepay"), team("team_1", "Payments"), team("team_3", "pay"),
				}},
			}},
			wantIDs: []string{"team_3", "team_1", "team_2"},
		},
		{
			name:    "text of spaces alone reads nothing",
			query:   "   ",
			wantIDs: []string{},
		},
		{
			name:  "an id finds its team without matching names",
			query: "team_1",
			reads: []read{{
				filter: idEquals("team_1"),
				result: database.ListResult[*domain.Team]{Items: []*domain.Team{team("team_1", "Payments")}},
			}},
			wantIDs: []string{"team_1"},
		},
		{
			name:  "text shaped like an id that finds no team is matched as a name",
			query: "team_blue",
			reads: []read{
				{filter: idEquals("team_blue")},
				{
					filter: nameContains("team_blue"),
					result: database.ListResult[*domain.Team]{Items: []*domain.Team{team("team_9", "team_blue crew")}},
				},
			},
			wantIDs: []string{"team_9"},
		},
		{
			name:  "more matches than the limit leave the type incomplete",
			query: "pay",
			limit: api.NewOptInt(1),
			reads: []read{{
				filter: nameContains("pay"),
				result: database.ListResult[*domain.Team]{Items: []*domain.Team{
					team("team_2", "Prepay"), team("team_1", "Payments"),
				}},
			}},
			wantIDs:        []string{"team_1"},
			wantIncomplete: []api.SearchResultType{api.SearchResultTypeTeam},
		},
		{
			name:  "a read that did not reach the end leaves the type incomplete",
			query: "pay",
			reads: []read{{
				filter: nameContains("pay"),
				result: database.ListResult[*domain.Team]{
					Items:      []*domain.Team{team("team_1", "Payments")},
					NextCursor: []byte("next"),
				},
			}},
			wantIDs:        []string{"team_1"},
			wantIncomplete: []api.SearchResultType{api.SearchResultTypeTeam},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			pool := servicemocks.NewMockPool(ctrl)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			pool.EXPECT().Statements().Return(stmts).AnyTimes()
			// One gate for the project, then one in front of every read.
			gates := 1 + len(tt.reads)
			stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil).Times(gates)
			stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(true, true, nil).Times(gates)
			var previous *gomock.Call
			for _, r := range tt.reads {
				call := stmts.EXPECT().ListTeams(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, opts *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
						filter, ok := opts.Filter.(database.AndFilter[domain.TeamField])
						require.True(t, ok, "filter is %T", opts.Filter)
						assert.Contains(t, filter.Filters, database.Equal(database.Col(domain.TeamFieldProjectID), "proj_home"))
						assert.Contains(t, filter.Filters, r.filter)
						assert.EqualValues(t, domain.SearchReadLimit, opts.Pagination.Limit)
						return &r.result, nil
					},
				)
				if previous != nil {
					call.After(previous)
				}
				previous = call.Call
			}
			db := service.NewPool(pool)
			h := Handler{pool: db, teamService: service.NewTeamService(db)}

			resp, err := h.Search(WithScopeContext(t.Context(), caller), &api.SearchRequest{
				Query:        tt.query,
				Types:        []api.SearchResultType{api.SearchResultTypeTeam},
				LimitPerType: tt.limit,
			}, api.SearchParams{})

			require.NoError(t, err)
			require.IsType(t, &api.SearchResponse{}, resp)
			got := resp.(*api.SearchResponse)
			ids := make([]string, 0, len(got.Results))
			for _, result := range got.Results {
				assert.Equal(t, api.SearchResultTypeTeam, result.Type)
				assert.Equal(t, api.ProjectID("proj_home"), result.ProjectID)
				ids = append(ids, result.ID)
			}
			assert.Equal(t, tt.wantIDs, ids)
			assert.ElementsMatch(t, tt.wantIncomplete, got.IncompleteTypes)
		})
	}
}

// A project the caller cannot see answers as the project, whichever type the
// search would have read first, and before anything is read.
func TestSearch_ProjectOutOfReach(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
	stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(false, false, nil)
	db := service.NewPool(pool)
	h := Handler{pool: db, teamService: service.NewTeamService(db)}

	_, err := h.Search(WithScopeContext(t.Context(), ScopeContext{
		ProjectID:     "proj_home",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
	}), &api.SearchRequest{
		Query: "pay",
		Types: []api.SearchResultType{api.SearchResultTypeUser, api.SearchResultTypeTeam},
	}, api.SearchParams{})

	assertDomainCode(t, err, domain.ErrProjectNotFound().Code)
}
