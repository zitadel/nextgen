package api

import (
	"context"
	"slices"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Search finds the resources of one project that match a text (ADR 087).
//
// Each requested type is read through its own management list, behind that
// list's own gate, so a caller finds exactly what the list would show them.
// The types run one after another: a list gate marks its context for one
// statement, and that mark is not safe to share between goroutines.
func (h *Handler) Search(ctx context.Context, req *api.SearchRequest, params api.SearchParams) (api.SearchRes, error) {
	projectID := listProjectID(ctx, params.ProjectID)
	// One answer for a project the caller cannot see, whichever type would
	// have been read first. Only the decision is used: each read below takes
	// its own gate, because this one's context is marked for one statement.
	if _, _, err := h.requireProjectListAccess(ctx, projectID, projectAccess, domain.ResourceKindProject); err != nil {
		return nil, err
	}

	resp := &api.SearchResponse{
		Results:         []api.SearchResult{},
		IncompleteTypes: []api.SearchResultType{},
	}
	query := domain.NormalizeSearchQuery(req.Query)
	if query == "" {
		return resp, nil
	}
	limit := req.LimitPerType.Or(searchDefaultLimitPerType)

	var (
		types   []domain.SearchResultType
		results []domain.SearchResult
	)
	for _, requested := range req.Types {
		resultType := domain.SearchResultType(requested)
		if slices.Contains(types, resultType) {
			continue
		}
		types = append(types, resultType)

		var (
			candidates []domain.SearchResult
			incomplete bool
			err        error
		)
		switch resultType {
		case domain.SearchResultTypeUser:
			candidates, incomplete, err = h.searchUsers(ctx, projectID, query, limit)
		case domain.SearchResultTypeTeam:
			candidates, incomplete, err = h.searchTeams(ctx, projectID, query)
		}
		if err != nil {
			return nil, err
		}
		best, more := domain.BestSearchResults(candidates, limit)
		results = append(results, best...)
		if incomplete || more {
			resp.IncompleteTypes = append(resp.IncompleteTypes, requested)
		}
	}

	domain.SortSearchResults(results, types)
	for _, result := range results {
		resp.Results = append(resp.Results, searchResultToAPI(result))
	}
	return resp, nil
}

// searchDefaultLimitPerType is the contract's default. The decoder fills it in
// when the body leaves limit_per_type out; this covers a caller that does not
// come through HTTP.
const searchDefaultLimitPerType = 5

// searchUsers finds the user whose id the text is, else the users whose
// identifier or display name it starts: the best limit of them, read from the
// search index. Text too short to tell users apart is reported as an
// incomplete read rather than answered with the first users in the alphabet.
func (h *Handler) searchUsers(ctx context.Context, projectID, query string, limit int) (_ []domain.SearchResult, incomplete bool, _ error) {
	if domain.IsSearchID(domain.PrefixUser, query) {
		// Text shaped like an id can still be an identifier ("user_ann"), so a
		// miss falls through to the text match.
		found, err := h.findUserForSearch(ctx, projectID, query)
		if err != nil || len(found) > 0 {
			return found, false, err
		}
	}
	if !domain.SearchQueryLongEnoughForUsers(query) {
		return nil, true, nil
	}
	ctx, _, err := h.requireProjectListAccess(ctx, projectID, userAccess, domain.ResourceKindUser)
	if err != nil {
		return nil, false, err
	}
	found, err := h.userService.SearchUsers(ctx, service.SearchUsersInput{ProjectID: projectID, Query: query, Limit: limit})
	if err != nil {
		return nil, false, err
	}
	term, _ := domain.SearchText(query)
	candidates := make([]domain.SearchResult, 0, len(found.Items))
	for _, user := range found.Items {
		result := userSearchResult(user)
		result.Rank = domain.SearchRankPrefix
		if user.MatchedText == term {
			result.Rank = domain.SearchRankWhole
		}
		candidates = append(candidates, result)
	}
	return candidates, found.More, nil
}

// findUserForSearch reads the user with the id, through the users list and
// its gate, so it finds only a user the list would show the caller.
func (h *Handler) findUserForSearch(ctx context.Context, projectID, id string) ([]domain.SearchResult, error) {
	ctx, _, err := h.requireProjectListAccess(ctx, projectID, userAccess, domain.ResourceKindUser)
	if err != nil {
		return nil, err
	}
	listed, err := h.userService.ListUsers(ctx, service.ListUsersInput{
		ProjectID: projectID,
		Limit:     1,
		Filters:   []service.Filter{{Field: "id", Operation: "equals", Value: id}},
	})
	if err != nil {
		return nil, err
	}
	found := make([]domain.SearchResult, 0, len(listed.Items))
	for _, user := range listed.Items {
		found = append(found, userSearchResult(user))
	}
	return found, nil
}

// userSearchResult names a user as every surface does (ADR 058): by their
// display, else their identifier, else their id. It ranks as an id match; a
// text match sets its own rank.
func userSearchResult(user *domain.User) domain.SearchResult {
	result := domain.SearchResult{
		Type:      domain.SearchResultTypeUser,
		ID:        user.ID,
		ProjectID: user.ProjectID,
		Title:     user.ID,
		Rank:      domain.SearchRankID,
	}
	if user.Ref != nil {
		switch identifier := user.Ref.Identifier; {
		case user.Ref.Display != "":
			result.Title = user.Ref.Display
			result.Subtitle = identifier
		case identifier != "":
			result.Title = identifier
		}
	}
	return result
}

// searchTeams finds the team whose id the text is, else the teams whose name
// contains it.
func (h *Handler) searchTeams(ctx context.Context, projectID, query string) (_ []domain.SearchResult, incomplete bool, _ error) {
	if domain.IsSearchID(domain.PrefixTeam, query) {
		// Text shaped like an id can still be a name ("team_blue"), so a miss
		// falls through to the text match.
		found, _, err := h.listTeamsForSearch(ctx, projectID, query, service.Filter{Field: "id", Operation: "equals", Value: query})
		if err != nil || len(found) > 0 {
			return found, false, err
		}
	}
	return h.listTeamsForSearch(ctx, projectID, query, service.Filter{Field: "name", Operation: "contains", Value: query})
}

func (h *Handler) listTeamsForSearch(ctx context.Context, projectID, query string, filter service.Filter) (_ []domain.SearchResult, incomplete bool, _ error) {
	ctx, _, err := h.requireProjectListAccess(ctx, projectID, teamAccess, domain.ResourceKindTeam)
	if err != nil {
		return nil, false, err
	}
	listed, err := h.teamService.List(ctx, service.ListTeamsRequest{
		ProjectID: projectID,
		Limit:     domain.SearchReadLimit,
		Filters:   []service.Filter{filter},
	})
	if err != nil {
		return nil, false, err
	}
	candidates := make([]domain.SearchResult, 0, len(listed.Teams))
	for _, team := range listed.Teams {
		result := domain.SearchResult{
			Type:      domain.SearchResultTypeTeam,
			ID:        team.ID,
			ProjectID: team.ProjectID,
			Title:     team.Name,
			Rank:      domain.SearchRankID,
		}
		if team.ID != query {
			result.Rank = min(domain.RankSearchText(query, team.Name), domain.SearchRankContains)
		}
		candidates = append(candidates, result)
	}
	return candidates, listed.NextPageToken != "", nil
}

func searchResultToAPI(result domain.SearchResult) api.SearchResult {
	out := api.SearchResult{
		Type:      api.SearchResultType(result.Type),
		ID:        result.ID,
		ProjectID: api.ProjectID(result.ProjectID),
		Title:     result.Title,
	}
	if result.Subtitle != "" {
		out.Subtitle = api.NewOptString(result.Subtitle)
	}
	return out
}
