package api

import (
	"context"
	"errors"
	"slices"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// searchProjectLimit is how many projects a session's search without
// project_id reads (ADR 087 §6): the newest of the projects listMyProjects
// lists. A platform operator can act on every project of the deployment, so
// the search is bounded by this, not by the person's grants.
const searchProjectLimit = 10

// searchProjectOrder reads the newest projects first, as the console's
// Projects list does (D28), from idx_projects_created_at.
const searchProjectOrder = "desc"

// Search finds the resources that match a text in one project, or in the
// projects the person behind a session can act on (ADR 087).
//
// Each project's list gate is decided once, for every type read in it, so a
// caller finds exactly what that type's list would show them. The projects
// whose gate allows every row are read together, one statement per kind of
// read whatever their number; only a project behind a narrower grant, and
// text shaped like an id, is read project by project. The reads run one after
// another, so a search holds one database connection at a time.
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
		types     []domain.SearchResultType
		requested []api.SearchResultType
	)
	for _, t := range req.Types {
		if resultType := domain.SearchResultType(t); !slices.Contains(types, resultType) {
			types = append(types, resultType)
			requested = append(requested, t)
		}
	}

	var (
		allowed  []string
		narrowed []projectListGate
	)
	for _, gate := range gates {
		if gate.allow {
			allowed = append(allowed, gate.projectID)
		} else {
			narrowed = append(narrowed, gate)
		}
	}
	found, err := h.searchAllowedProjects(ctx, allowed, types, query, limit)
	if err != nil {
		return nil, err
	}

	var results []domain.SearchResult
	for j, resultType := range types {
		candidates := found[resultType].results
		incomplete := moreProjects || found[resultType].more
		for _, gate := range narrowed {
			results, more, err := h.searchProjectType(ctx, gate, resultType, query, limit)
			if err != nil {
				return nil, err
			}
			candidates = append(candidates, results...)
			incomplete = incomplete || more
		}
		best, more := domain.BestSearchResults(candidates, limit)
		results = append(results, best...)
		if incomplete || more {
			resp.IncompleteTypes = append(resp.IncompleteTypes, requested[j])
		}
	}

	domain.SortSearchResults(results, types)
	for _, result := range results {
		resp.Results = append(resp.Results, searchResultToAPI(result))
	}
	return resp, nil
}

// searchFinds is what the searched projects hold of one type: its candidates,
// and whether there are more than were read.
type searchFinds struct {
	results []domain.SearchResult
	more    bool
}

// searchEntryKinds are the types found by their search entries, by the kind
// their entries are written under.
var searchEntryKinds = map[domain.SearchResultType]domain.ResourceKind{
	domain.SearchResultTypeTeam:           domain.ResourceKindTeam,
	domain.SearchResultTypeSchema:         domain.ResourceKindSchema,
	domain.SearchResultTypeFlowDefinition: domain.ResourceKindFlowDefinition,
	domain.SearchResultTypeIDP:            domain.ResourceKindIDPConnection,
}

// searchIDShaped reports whether query is shaped like the id of a resource of
// resultType, which is read by its key, project by project.
func searchIDShaped(resultType domain.SearchResultType, query string) bool {
	switch resultType {
	case domain.SearchResultTypeUser:
		return domain.IsSearchID(domain.PrefixUser, query)
	case domain.SearchResultTypeTeam:
		return domain.IsSearchID(domain.PrefixTeam, query)
	case domain.SearchResultTypeSchema:
		return domain.IsSearchSchemaID(query)
	case domain.SearchResultTypeFlowDefinition:
		return domain.IsSearchID(domain.PrefixFlowDefinition, query)
	case domain.SearchResultTypeIDP:
		return domain.IsSearchID(domain.PrefixIDPConnection, query)
	}
	return false
}

// searchAllowedProjects finds every type in the projects whose gate allows the
// caller every row, read across all of them: one statement for the search
// entries of every kind, and the users' reads, which do not grow with the
// projects either. Text shaped like an id is read by its key in each project.
func (h *Handler) searchAllowedProjects(ctx context.Context, projectIDs []string, types []domain.SearchResultType, query string, limit int) (map[domain.SearchResultType]searchFinds, error) {
	found := make(map[domain.SearchResultType]searchFinds, len(types))
	if len(projectIDs) == 0 {
		return found, nil
	}
	var entryKinds []domain.ResourceKind
	for _, resultType := range types {
		if searchIDShaped(resultType, query) {
			finds := searchFinds{}
			for _, projectID := range projectIDs {
				results, more, err := h.searchProjectType(ctx, projectListGate{projectID: projectID, allow: true}, resultType, query, limit)
				if err != nil {
					return nil, err
				}
				finds.results = append(finds.results, results...)
				finds.more = finds.more || more
			}
			found[resultType] = finds
			continue
		}
		if kind, ok := searchEntryKinds[resultType]; ok {
			entryKinds = append(entryKinds, kind)
			continue
		}
		if resultType != domain.SearchResultTypeUser {
			continue
		}
		if !domain.SearchQueryLongEnoughForUsers(query) {
			found[resultType] = searchFinds{more: true}
			continue
		}
		users, err := h.userService.SearchUsersInProjects(service.WithAuthzListSkipOnce(ctx), service.SearchUsersInProjectsInput{
			ProjectIDs: projectIDs,
			Query:      query,
			Limit:      limit,
		})
		if err != nil {
			return nil, err
		}
		found[resultType] = searchFinds{results: userSearchResults(users.Items, query), more: users.More}
	}
	if len(entryKinds) == 0 {
		return found, nil
	}
	entries, err := service.SearchEntriesInProjects(service.WithAuthzListSkipOnce(ctx), h.pool.Statements(), service.SearchEntriesInProjectsInput{
		ProjectIDs: projectIDs,
		Kinds:      entryKinds,
		Query:      query,
		Limit:      limit,
	})
	if err != nil {
		return nil, err
	}
	for resultType, kind := range searchEntryKinds {
		if out, ok := entries[kind]; ok {
			found[resultType] = searchFinds{results: entryMatchResults(resultType, out.Items, query), more: out.More}
		}
	}
	return found, nil
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
	// One resolver for the operator question and the projects' check, which
	// share the active catalog it reads.
	r := resolver.New()
	operator, err := h.platformOperatorWith(ctx, r, scope)
	if err != nil {
		return nil, false, err
	}
	req := service.ListAuthorizedProjectsRequest{
		HomeProjectID: self.ProjectID(),
		UserID:        self.UserID(),
		Order:         searchProjectOrder,
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

	// One access check for all of them: a statement for the grants, and at
	// most one for the platform operator path.
	ids := make([]string, 0, len(listed.Projects))
	for _, project := range listed.Projects {
		if credentialCeiling(scope, project.ID) == nil {
			ids = append(ids, project.ID)
		}
	}
	gates := make([]projectListGate, 0, len(ids))
	if len(ids) == 0 {
		return gates, listed.NextPageToken != "", nil
	}
	decisions, paths, err := r.CheckProjects(ctx, stmts, projectCheckRequest(scope, ids[0], opRead, nil), ids)
	if err != nil {
		return nil, false, domain.ErrInternal(err).WithMessage("authz permission check failed")
	}
	marked := false
	for i, projectID := range ids {
		switch decisions[i] {
		case resolver.DecisionAllow:
			if paths[i] == resolver.PathPlatformOperator && !marked {
				markPlatformOperator(ctx, scope)
				marked = true
			}
			gates = append(gates, projectListGate{projectID: projectID, allow: true})
		case resolver.DecisionForbidden:
			// A grant narrower than the project: its rows are read through
			// that grant's filter, as on the type's own list. The catalog
			// the check read is reused.
			params, err := authzListFilterParams(ctx, r, stmts, projectID, opRead)
			if err != nil {
				return nil, false, err
			}
			gates = append(gates, projectListGate{projectID: projectID, params: params})
		default:
			// A grant can list a project without reaching its lists, and a
			// project can go between the two reads: either has nothing to
			// search.
		}
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
	return userSearchResults(found.Items, query), found.More, nil
}

// userSearchResults are the results for users a text search found, ranked by
// the text of theirs that matched.
func userSearchResults(users []*domain.User, query string) []domain.SearchResult {
	term, _ := domain.SearchText(query)
	results := make([]domain.SearchResult, 0, len(users))
	for _, user := range users {
		result := userSearchResult(user)
		result.Rank = domain.SearchRankPrefix
		if user.MatchedText == term {
			result.Rank = domain.SearchRankWhole
		}
		results = append(results, result)
	}
	return results
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
	return entryMatchResults(resultType, found.Items, query), found.More, nil
}

// entryMatchResults are the results for the search entries a text matched.
func entryMatchResults(resultType domain.SearchResultType, matches []domain.SearchEntryMatch, query string) []domain.SearchResult {
	term, _ := domain.SearchText(query)
	results := make([]domain.SearchResult, 0, len(matches))
	for _, match := range matches {
		results = append(results, domain.SearchResult{
			Type:      resultType,
			ID:        match.ResourceID,
			ProjectID: match.ProjectID,
			Title:     match.Title,
			Subtitle:  match.Subtitle,
			Rank:      match.Rank(term),
		})
	}
	return results
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
// names as `$id`, so text shaped like one is read by it first: a read of one
// primary key.
func (h *Handler) searchSchemas(ctx context.Context, gate projectListGate, query string, limit int) ([]domain.SearchResult, bool, error) {
	if domain.IsSearchSchemaID(query) {
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
