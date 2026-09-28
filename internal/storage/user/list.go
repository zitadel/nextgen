package user

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

// EnsureListOptions returns opts with the default CreatedAt+ID ASC order when
// OrderBy is unset. A nil opts becomes an empty ListOptions.
func EnsureListOptions(opts *database.ListOptions[domain.UserField]) *database.ListOptions[domain.UserField] {
	if opts == nil {
		opts = &database.ListOptions[domain.UserField]{}
	}
	out := *opts
	if len(out.Pagination.OrderBy.Columns) == 0 {
		out.Pagination.OrderBy = database.OrderBy[domain.UserField]{
			Columns: []database.Column[domain.UserField]{
				database.Col(domain.UserFieldCreatedAt),
				database.Col(domain.UserFieldID),
			},
			Direction: database.OrderAsc,
		}
	}
	return &out
}

// ApplyCursor adds a keyset cursor predicate to filter when page.Cursor is set.
func ApplyCursor(filter database.Filter[domain.UserField], page database.Page[domain.UserField]) (database.Filter[domain.UserField], error) {
	if len(page.Cursor) == 0 {
		return filter, nil
	}
	cursor, err := pagination.CursorFromToken[domain.UserField](page.Cursor)
	if err != nil {
		return nil, database.ErrInvalidCursor()
	}
	if !cursor.MatchesOrderBy(page.OrderBy) {
		return nil, database.ErrCursorOrderMismatch()
	}
	values, err := Schema.CoerceCursorValues(cursor.Columns, cursor.Values)
	if err != nil {
		return nil, database.ErrInvalidCursor().WithParent(err)
	}
	terms := make([]database.CompareTerm[domain.UserField], len(cursor.Columns))
	for i, column := range cursor.Columns {
		terms[i] = database.Term(column, values[i])
	}
	if page.OrderBy.Direction == database.OrderAsc {
		return database.And(filter, database.CompareGreater(terms...)), nil
	}
	return database.And(filter, database.CompareLess(terms...)), nil
}

// NextCursor returns a marshaled keyset cursor when the page is full; otherwise nil.
func NextCursor(users []*domain.User, page database.Page[domain.UserField]) []byte {
	return pagination.MarshalNext(page.OrderBy, users, Schema, page.Limit)
}

// ProjectGroup is one project's users prepared for attribute hydration.
type ProjectGroup struct {
	ProjectID string
	IDs       []string
	ByID      map[string]*domain.User
}

// MembershipStatusStrings are the states an embedded membership list serves,
// as the strings the column stores. It is [domain.RosterMembershipStatuses]
// rendered once here so the three dialects cannot drift from each other or
// from the paginated ListUserTeams read.
func MembershipStatusStrings() []string {
	out := make([]string, 0, len(domain.RosterMembershipStatuses))
	for _, s := range domain.RosterMembershipStatuses {
		out = append(out, s.String())
	}
	return out
}

// TeamCollector places membership rows on the users they belong to, capping
// each user's list and flagging the ones that were cut.
//
// The dialects hand over every current membership of the page's users, in
// user-then-team-name order; the cap lives here rather than in the query
// because bounding it per user needs a window function the Spanner emulator
// rejects. Rows arriving past the cap set the truncation flag and are dropped.
type TeamCollector struct {
	byID  map[string]*domain.User
	limit int
}

// NewTeamCollector prepares collection into group, which must be the same
// group the membership query was keyed on. Every user in it starts with an empty,
// non-nil slice: the read was asked for teams, so "no teams" must serialize
// as [] rather than as absent.
func NewTeamCollector(group ProjectGroup, limit int) *TeamCollector {
	for _, u := range group.ByID {
		u.Teams = []domain.UserTeam{}
		u.TeamsTruncated = false
	}
	return &TeamCollector{byID: group.ByID, limit: limit}
}

// Add places one membership row. Rows past the cap are dropped and mark the user
// truncated. Rows for a user outside the page are ignored.
func (c *TeamCollector) Add(userID string, team domain.UserTeam) {
	user, ok := c.byID[userID]
	if !ok {
		return
	}
	if len(user.Teams) >= c.limit {
		user.TeamsTruncated = true
		return
	}
	user.Teams = append(user.Teams, team)
}

// OwnerTeamCollector places lifecycle owner teams on the users they own.
//
// Unlike an embedded collection this needs no cap: each user has at most one
// owner, so the second read is bounded by the page's distinct owner ids rather
// than by anything the data can grow.
type OwnerTeamCollector struct {
	byTeamID map[string][]*domain.User
	teamIDs  []string
}

// NewOwnerTeamCollector indexes group's users by the team that owns them.
// Self-owned users are absent from the index and keep a nil owner.
//
// Every user in the group is marked loaded up front, the way NewTeamCollector
// gives each one an empty list: the read was asked for the owner, so a
// self-owned user must serialize as null rather than as absent.
func NewOwnerTeamCollector(group ProjectGroup) *OwnerTeamCollector {
	c := &OwnerTeamCollector{byTeamID: make(map[string][]*domain.User)}
	// Walk IDs rather than ranging ByID: map order is random, and TeamIDs
	// feeds a query whose parameters the dialect tests compare.
	for _, id := range group.IDs {
		user, ok := group.ByID[id]
		if !ok {
			continue
		}
		user.LifecycleOwnerTeam = nil
		user.LifecycleOwnerTeamLoaded = true
		teamID, owned := user.OwningTeamID()
		if !owned {
			continue
		}
		if _, seen := c.byTeamID[teamID]; !seen {
			c.teamIDs = append(c.teamIDs, teamID)
		}
		c.byTeamID[teamID] = append(c.byTeamID[teamID], user)
	}
	return c
}

// TeamIDs are the distinct owner team ids the page refers to, in page order.
// Empty means every user in the group is self-owned and no second query is
// worth running.
func (c *OwnerTeamCollector) TeamIDs() []string { return c.teamIDs }

// Add places one team on every user it owns. A team no user in the page is
// owned by is ignored.
func (c *OwnerTeamCollector) Add(team domain.Team) {
	for _, user := range c.byTeamID[team.ID] {
		user.LifecycleOwnerTeam = &team
	}
}

// GroupByProject clears Attributes and groups users by ProjectID for hydration.
func GroupByProject(users []*domain.User) []ProjectGroup {
	byProject := make(map[string]*ProjectGroup, len(users))
	order := make([]string, 0, len(users))
	for _, u := range users {
		u.Attributes = nil
		g, ok := byProject[u.ProjectID]
		if !ok {
			g = &ProjectGroup{
				ProjectID: u.ProjectID,
				ByID:      make(map[string]*domain.User),
			}
			byProject[u.ProjectID] = g
			order = append(order, u.ProjectID)
		}
		g.IDs = append(g.IDs, u.ID)
		g.ByID[u.ID] = u
	}
	out := make([]ProjectGroup, 0, len(order))
	for _, projectID := range order {
		out = append(out, *byProject[projectID])
	}
	return out
}
