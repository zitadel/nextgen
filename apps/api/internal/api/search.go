package api

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// searchProjectLimit is how many projects a session's search without
// project_id reads (ADR 087 §6): the first of the projects listMyProjects
// lists. A platform operator can act on every project of the deployment, so
// the search is bounded by this, not by the person's grants.
const searchProjectLimit = 10

// Search finds the resources that match a text in one project, or in the
// projects the person behind a session can act on (ADR 087).
//
// Each requested type is read through the list gate of its project, decided
// once per project, so a caller finds exactly what that type's list would show
// them. The reads run one after another: a list gate marks its context for one
// statement, and that mark is not safe to share between goroutines.
func (h *Handler) Search(ctx context.Context, req *api.SearchRequest, params api.SearchParams) (api.SearchRes, error) {
	gates, moreProjects, err := h.searchGates(ctx, params.ProjectID)
	if err != nil {
		return nil, err
	}

	resp := &api.SearchResponse{
		Results:         []api.SearchResult{},
		IncompleteTypes: []api.SearchResultType{},
		MoreProjects:    moreProjects,
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

		var candidates []domain.SearchResult
		incomplete := moreProjects
		for _, gate := range gates {
			found, more, err := h.searchProjectType(ctx, gate, resultType, query, limit)
			if err != nil {
				return nil, err
			}
			candidates = append(candidates, found...)
			incomplete = incomplete || more
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

// searchGates decides which projects a search reads and what of each. A named
// project, or a project secret's own, is one project, and a caller who cannot
// read it is answered as for any project-scoped read. A session without
// project_id reads the projects the person can act on, listed as
// listMyProjects lists them; the bool says there are more than one search
// reads.
func (h *Handler) searchGates(ctx context.Context, projectID api.OptProjectID) ([]projectListGate, bool, error) {
	stmts := h.pool.Statements()
	if _, session := sessionTokenFromContext(ctx); session && !projectID.Set {
		return h.searchSessionGates(ctx, stmts)
	}
	gate, err := decideProjectListGate(ctx, stmts, listProjectID(ctx, projectID), projectAccess)
	if err != nil {
		return nil, false, err
	}
	return []projectListGate{gate}, false, nil
}

func (h *Handler) searchSessionGates(ctx context.Context, stmts service.AuthzResolverStatements) ([]projectListGate, bool, error) {
	self, err := requireSelf(ctx, api.OptProjectID{})
	if err != nil {
		return nil, false, err
	}
	scope, _ := GetScopeContext(ctx)
	operator, err := h.platformOperator(ctx, scope)
	if err != nil {
		return nil, false, err
	}
	req := service.ListAuthorizedProjectsRequest{
		HomeProjectID: self.ProjectID(),
		UserID:        self.UserID(),
		Limit:         searchProjectLimit,
	}
	var listed *service.ListProjectsResponse
	if operator {
		listed, err = h.projectService.ListEveryProject(ctx, req)
	} else {
		listed, err = h.projectService.ListAuthorized(ctx, req)
	}
	if err != nil {
		// As listMyProjects answers it: a refused session looks like an
		// anonymous one, never like a genuine cookie of a deactivated user.
		if errors.Is(err, domain.ErrSessionTokenInvalid()) {
			return nil, false, invalidSessionCredential(err)
		}
		return nil, false, err
	}

	gates := make([]projectListGate, 0, len(listed.Projects))
	for _, project := range listed.Projects {
		gate, err := decideProjectListGate(ctx, stmts, project.ID, projectAccess)
		if err != nil {
			// A grant can list a project without reaching its lists, and a
			// project can go between the two reads: either has nothing to
			// search. Anything else is a fault, not an answer.
			if errors.Is(err, domain.ErrProjectNotFound()) || errors.Is(err, domain.ErrProjectPermissionDenied()) {
				continue
			}
			return nil, false, err
		}
		gates = append(gates, gate)
	}
	return gates, listed.NextPageToken != "", nil
}

// searchProjectType finds the candidates of one type in one project. The bool
// says the type has more matches there than it read.
func (h *Handler) searchProjectType(ctx context.Context, gate projectListGate, resultType domain.SearchResultType, query string, limit int) ([]domain.SearchResult, bool, error) {
	switch resultType {
	case domain.SearchResultTypeUser:
		return h.searchUsers(ctx, gate, query, limit)
	case domain.SearchResultTypeTeam:
		return h.searchTeams(ctx, gate, query, limit)
	case domain.SearchResultTypeSchema:
		return h.searchSchemas(ctx, gate, query, limit)
	case domain.SearchResultTypeFlowDefinition:
		return h.searchFlowDefinitions(ctx, gate, query, limit)
	case domain.SearchResultTypeIDP:
		return h.searchIDPs(ctx, gate, query, limit)
	}
	return nil, false, nil
}

// searchUsers finds the user whose id the text is, else the users whose
// identifier or display name it starts: the best limit of them, read from the
// search index. Text too short to tell users apart is reported as an
// incomplete read rather than answered with the first users in the alphabet.
func (h *Handler) searchUsers(ctx context.Context, gate projectListGate, query string, limit int) (_ []domain.SearchResult, incomplete bool, _ error) {
	if domain.IsSearchID(domain.PrefixUser, query) {
		// Text shaped like an id can still be an identifier ("user_ann"), so a
		// miss falls through to the text match.
		found, err := h.findUserForSearch(ctx, gate, query)
		if err != nil || len(found) > 0 {
			return found, false, err
		}
	}
	if !domain.SearchQueryLongEnoughForUsers(query) {
		return nil, true, nil
	}
	found, err := h.userService.SearchUsers(gate.listContext(ctx, domain.ResourceKindUser), service.SearchUsersInput{
		ProjectID: gate.projectID,
		Query:     query,
		Limit:     limit,
	})
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
func (h *Handler) findUserForSearch(ctx context.Context, gate projectListGate, id string) ([]domain.SearchResult, error) {
	listed, err := h.userService.ListUsers(gate.listContext(ctx, domain.ResourceKindUser), service.ListUsersInput{
		ProjectID: gate.projectID,
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

// searchByEntries finds the resources of kind whose names the text starts, or
// a word in them, from their search entries: one range of one index, read
// behind the kind's list gate.
func (h *Handler) searchByEntries(ctx context.Context, gate projectListGate, resultType domain.SearchResultType, kind domain.ResourceKind, query string, limit int) ([]domain.SearchResult, bool, error) {
	found, err := service.SearchEntries(gate.listContext(ctx, kind), h.pool.Statements(), service.SearchEntriesInput{
		Kind:      kind,
		ProjectID: gate.projectID,
		Query:     query,
		Limit:     limit,
	})
	if err != nil {
		return nil, false, err
	}
	term, _ := domain.SearchText(query)
	candidates := make([]domain.SearchResult, 0, len(found.Items))
	for _, match := range found.Items {
		candidates = append(candidates, domain.SearchResult{
			Type:      resultType,
			ID:        match.ResourceID,
			ProjectID: match.ProjectID,
			Title:     match.Title,
			Subtitle:  match.Subtitle,
			Rank:      match.Rank(term),
		})
	}
	return candidates, found.More, nil
}

// searchTeams finds the team whose id the text is, else the teams whose name
// it starts, or a word in it.
func (h *Handler) searchTeams(ctx context.Context, gate projectListGate, query string, limit int) ([]domain.SearchResult, bool, error) {
	if domain.IsSearchID(domain.PrefixTeam, query) {
		// Text shaped like an id can still be a name ("team_blue"), so a miss
		// falls through to the text match.
		listed, err := h.teamService.List(gate.listContext(ctx, domain.ResourceKindTeam), service.ListTeamsRequest{
			ProjectID: gate.projectID,
			Limit:     1,
			Filters:   []service.Filter{{Field: "id", Operation: "equals", Value: query}},
		})
		if err != nil {
			return nil, false, err
		}
		if len(listed.Teams) > 0 {
			team := listed.Teams[0]
			return []domain.SearchResult{{
				Type:      domain.SearchResultTypeTeam,
				ID:        team.ID,
				ProjectID: team.ProjectID,
				Title:     team.Name,
				Rank:      domain.SearchRankID,
			}}, false, nil
		}
	}
	return h.searchByEntries(ctx, gate, domain.SearchResultTypeTeam, domain.ResourceKindTeam, query, limit)
}

// searchSchemas finds the user schema whose newest revision's id the text is,
// else the user schemas whose title or object type it starts, or a word in
// them, at their newest revision. A schema's id can be the URI its document
// names as `$id`, so any text without a space is tried as one: a read of one
// primary key.
func (h *Handler) searchSchemas(ctx context.Context, gate projectListGate, query string, limit int) ([]domain.SearchResult, bool, error) {
	if !strings.ContainsFunc(query, unicode.IsSpace) {
		kind := domain.JSONSchemaKindUserSchema
		listed, err := h.schemaService.ListSchemas(gate.listContext(ctx, domain.ResourceKindSchema), service.ListSchemasInput{
			ProjectID:                   gate.projectID,
			ID:                          query,
			Kind:                        &kind,
			LatestRevisionPerObjectType: true,
			Limit:                       1,
		})
		if err != nil {
			return nil, false, err
		}
		if len(listed.Items) > 0 {
			if entry, ok := domain.SchemaSearchEntry(listed.Items[0]); ok {
				return []domain.SearchResult{entryResult(domain.SearchResultTypeSchema, entry)}, false, nil
			}
		}
	}
	return h.searchByEntries(ctx, gate, domain.SearchResultTypeSchema, domain.ResourceKindSchema, query, limit)
}

// searchFlowDefinitions finds the flow definition whose newest revision's id
// the text is, else the flow definitions whose name it starts, or a word in
// it, at their newest revision.
func (h *Handler) searchFlowDefinitions(ctx context.Context, gate projectListGate, query string, limit int) ([]domain.SearchResult, bool, error) {
	if domain.IsSearchID(domain.PrefixFlowDefinition, query) {
		listed, err := h.flowDefinitionService.List(gate.listContext(ctx, domain.ResourceKindFlowDefinition), service.ListFlowDefinitionsRequest{
			ProjectID:             gate.projectID,
			ID:                    query,
			LatestRevisionPerName: true,
			Limit:                 1,
		})
		if err != nil {
			return nil, false, err
		}
		if len(listed.Items) > 0 {
			entry := domain.FlowDefinitionSearchEntry(listed.Items[0])
			return []domain.SearchResult{entryResult(domain.SearchResultTypeFlowDefinition, entry)}, false, nil
		}
	}
	return h.searchByEntries(ctx, gate, domain.SearchResultTypeFlowDefinition, domain.ResourceKindFlowDefinition, query, limit)
}

// searchIDPs finds the connection whose id the text is, else the connections
// whose slug or display name it starts, or a word in them.
func (h *Handler) searchIDPs(ctx context.Context, gate projectListGate, query string, limit int) ([]domain.SearchResult, bool, error) {
	if domain.IsSearchID(domain.PrefixIDPConnection, query) {
		listed, err := h.idpConnectionService.List(gate.listContext(ctx, domain.ResourceKindIDPConnection), service.ListIDPConnectionsInput{
			ProjectID: gate.projectID,
			ID:        query,
			Limit:     1,
		})
		if err != nil {
			return nil, false, err
		}
		if len(listed.Items) > 0 {
			entry := domain.IDPConnectionSearchEntry(listed.Items[0])
			return []domain.SearchResult{entryResult(domain.SearchResultTypeIDP, entry)}, false, nil
		}
	}
	return h.searchByEntries(ctx, gate, domain.SearchResultTypeIDP, domain.ResourceKindIDPConnection, query, limit)
}

// entryResult is the result for a resource found by its id, titled as its
// search entry titles it.
func entryResult(resultType domain.SearchResultType, entry domain.SearchEntry) domain.SearchResult {
	return domain.SearchResult{
		Type:      resultType,
		ID:        entry.ResourceID,
		ProjectID: entry.ProjectID,
		Title:     entry.Title,
		Subtitle:  entry.Subtitle,
		Rank:      domain.SearchRankID,
	}
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
