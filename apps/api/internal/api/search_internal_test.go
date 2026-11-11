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

// Search decides the project's list gate once, then reads a type behind it:
// a team by its id through the teams list, a team by name from the search
// entries. The mock refuses any statement a case does not expect, so a case
// that names its reads also proves nothing else was read: no user is listed
// for a search that asks for teams.
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
	match := func(id, title, text string, nameStart bool) domain.SearchEntryMatch {
		return domain.SearchEntryMatch{ResourceID: id, ProjectID: "proj_home", Title: title, MatchedText: text, NameStart: nameStart}
	}
	repeat := func(n int, m domain.SearchEntryMatch) []domain.SearchEntryMatch {
		out := make([]domain.SearchEntryMatch, n)
		for i := range out {
			out[i] = m
		}
		return out
	}
	// A read is either a team list by id or a search of the entries.
	type read struct {
		id      string
		teams   []*domain.Team
		prefix  string
		rows    int
		matches []domain.SearchEntryMatch
	}

	for _, tt := range []struct {
		name  string
		query string
		limit api.OptInt
		// reads are the reads the search makes, in order.
		reads          []read
		wantIDs        []string
		wantIncomplete []api.SearchResultType
	}{
		{
			name:  "ranks the matches of the trimmed text",
			query: "  pay ",
			reads: []read{{
				prefix: "pay",
				rows:   24,
				matches: []domain.SearchEntryMatch{
					match("team_2", "Big Pay", "pay", false),
					match("team_3", "pay", "pay", true),
					match("team_1", "Payments", "payments", true),
				},
			}},
			wantIDs: []string{"team_3", "team_1", "team_2"},
		},
		{
			name:    "text of spaces alone reads nothing",
			query:   "   ",
			wantIDs: []string{},
		},
		{
			name:    "an id finds its team without matching names",
			query:   "team_1",
			reads:   []read{{id: "team_1", teams: []*domain.Team{team("team_1", "Payments")}}},
			wantIDs: []string{"team_1"},
		},
		{
			name:  "text shaped like an id that finds no team is matched as a name",
			query: "team_blue",
			reads: []read{
				{id: "team_blue"},
				{prefix: "team_blue", rows: 24, matches: []domain.SearchEntryMatch{match("team_9", "team_blue crew", "team_blue crew", true)}},
			},
			wantIDs: []string{"team_9"},
		},
		{
			name:  "a team found by two of its texts is one result, ranked by the better",
			query: "pay",
			reads: []read{{
				prefix: "pay",
				rows:   24,
				matches: []domain.SearchEntryMatch{
					match("team_1", "Pay Pay", "pay", false),
					match("team_1", "Pay Pay", "pay pay", true),
				},
			}},
			wantIDs: []string{"team_1"},
		},
		{
			name:  "more matches than the limit leave the type incomplete",
			query: "pay",
			limit: api.NewOptInt(1),
			reads: []read{{
				prefix: "pay",
				rows:   8,
				matches: []domain.SearchEntryMatch{
					match("team_1", "Payments", "payments", true),
					match("team_2", "Payroll", "payroll", true),
				},
			}},
			wantIDs:        []string{"team_1"},
			wantIncomplete: []api.SearchResultType{api.SearchResultTypeTeam},
		},
		{
			name:  "a read that stopped at its row limit leaves the type incomplete",
			query: "pay",
			limit: api.NewOptInt(1),
			reads: []read{{
				prefix:  "pay",
				rows:    8,
				matches: repeat(8, match("team_1", "Payments", "payments", true)),
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
			// One gate for the project, whatever the search reads behind it.
			stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
			stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(true, true, nil)
			var previous *gomock.Call
			for _, r := range tt.reads {
				var call *gomock.Call
				if r.id != "" {
					call = stmts.EXPECT().ListTeams(gomock.Any(), gomock.Any()).DoAndReturn(
						func(ctx context.Context, opts *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
							assert.True(t, service.AuthzListSkipOncePending(ctx), "read behind the project's gate")
							filter, ok := opts.Filter.(database.AndFilter[domain.TeamField])
							require.True(t, ok, "filter is %T", opts.Filter)
							assert.Contains(t, filter.Filters, database.Equal(database.Col(domain.TeamFieldProjectID), "proj_home"))
							assert.Contains(t, filter.Filters, database.StringEqual(database.Col(domain.TeamFieldID), r.id))
							return &database.ListResult[*domain.Team]{Items: r.teams}, nil
						},
					).Call
				} else {
					call = stmts.EXPECT().SearchEntries(gomock.Any(), domain.ResourceKindTeam, "proj_home", r.prefix, r.rows).DoAndReturn(
						func(ctx context.Context, _ domain.ResourceKind, _, _ string, limit int) ([]domain.SearchEntryMatch, bool, error) {
							assert.True(t, service.AuthzListSkipOncePending(ctx), "read behind the project's gate")
							return r.matches, len(r.matches) == limit, nil
						},
					).Call
				}
				if previous != nil {
					call.After(previous)
				}
				previous = call
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
			assert.False(t, got.MoreProjects)
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
