package service

import (
	"context"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// MaxProjectAdmins caps the unpaginated admins list. A project past it, which
// takes an admin grant to a very large team, gets the first people by user id
// and a truncated list.
const MaxProjectAdmins = 1000

type ProjectAdminSourceType string

const (
	ProjectAdminSourceOwningTeam ProjectAdminSourceType = "owning_team"
	ProjectAdminSourceGrant      ProjectAdminSourceType = "grant"
)

type ProjectAdminSource struct {
	Type    ProjectAdminSourceType
	GrantID string
	Team    *TeamRef
}

type ProjectAdmin struct {
	User    domain.UserRef
	Sources []ProjectAdminSource
}

type ProjectAdmins struct {
	Admins []*ProjectAdmin
	// Truncated reports that more than MaxProjectAdmins people administer the
	// project and only the first of them are listed.
	Truncated bool
}

// sourcedAdmin is one person's admin access through one source.
type sourcedAdmin struct {
	userID string
	home   string
	source ProjectAdminSource
}

// teamSource is a team whose members are admins through source.
type teamSource struct {
	teamID string
	source ProjectAdminSource
}

// ListProjectAdmins lists the people who administer a project, ordered by user
// id.
//
// It is not paginated: the sources live in different tables, so the list is
// built whole on every call, and the people who administer one project are
// few. MaxProjectAdmins bounds it.
func (s *GrantService) ListProjectAdmins(ctx context.Context, projectID string) (*ProjectAdmins, error) {
	if projectID == "" {
		return nil, domain.ErrProjectMissingID()
	}
	owningTeam, err := s.owningTeamAdmins(ctx, projectID)
	if err != nil {
		return nil, err
	}
	teamGranted, err := s.teamGrantAdmins(ctx, projectID)
	if err != nil {
		return nil, err
	}
	userGranted, err := s.userGrantAdmins(ctx, projectID)
	if err != nil {
		return nil, err
	}

	admins := map[string]*ProjectAdmin{}
	homes := map[string]string{}
	for _, sourced := range slices.Concat(owningTeam, teamGranted, userGranted) {
		admin, ok := admins[sourced.userID]
		if !ok {
			admin = &ProjectAdmin{User: domain.UserRef{UserID: sourced.userID}}
			admins[sourced.userID] = admin
			homes[sourced.userID] = sourced.home
		}
		admin.Sources = append(admin.Sources, sourced.source)
	}
	sorted := slices.SortedFunc(maps.Values(admins), func(a, b *ProjectAdmin) int {
		return strings.Compare(a.User.UserID, b.User.UserID)
	})
	out := &ProjectAdmins{Admins: sorted}
	if len(sorted) > MaxProjectAdmins {
		out.Admins, out.Truncated = sorted[:MaxProjectAdmins], true
	}
	if err := s.resolveAdminRefs(ctx, out.Admins, homes); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *GrantService) owningTeamAdmins(ctx context.Context, projectID string) ([]sourcedAdmin, error) {
	teamID, err := activeOwningTeamID(ctx, s.v2Pool.Statements(), projectID)
	if err != nil || teamID == "" {
		return nil, err
	}
	return s.teamAdmins(ctx, []teamSource{{teamID: teamID, source: ProjectAdminSource{Type: ProjectAdminSourceOwningTeam}}})
}

func (s *GrantService) teamGrantAdmins(ctx context.Context, projectID string) ([]sourcedAdmin, error) {
	grants, err := s.activeAdminGrants(ctx, projectID, domain.AuthzPrincipalTypeTeam)
	if err != nil {
		return nil, err
	}
	teams := make([]teamSource, 0, len(grants))
	for _, grant := range grants {
		teams = append(teams, teamSource{teamID: grant.PrincipalID, source: ProjectAdminSource{Type: ProjectAdminSourceGrant, GrantID: grant.ID}})
	}
	return s.teamAdmins(ctx, teams)
}

func (s *GrantService) userGrantAdmins(ctx context.Context, projectID string) ([]sourcedAdmin, error) {
	grants, err := s.activeAdminGrants(ctx, projectID, domain.AuthzPrincipalTypeUser)
	if err != nil {
		return nil, err
	}
	homes, err := s.principalHomes(ctx, grantPrincipalIDs(grants))
	if err != nil {
		return nil, err
	}
	out := make([]sourcedAdmin, 0, len(grants))
	for _, grant := range grants {
		if home := homes[grant.PrincipalID]; home != "" {
			out = append(out, sourcedAdmin{
				userID: grant.PrincipalID,
				home:   home,
				source: ProjectAdminSource{Type: ProjectAdminSourceGrant, GrantID: grant.ID},
			})
		}
	}
	return out, nil
}

// teamAdmins returns the members of each team under its source, with the
// team's ref attached. Membership is read from authz_membership_edges, the
// table the resolver expands team grants through, so the list matches the
// check. Teams and edges are read in one batch per home project.
func (s *GrantService) teamAdmins(ctx context.Context, teams []teamSource) ([]sourcedAdmin, error) {
	if len(teams) == 0 {
		return nil, nil
	}
	teamIDs := make([]string, 0, len(teams))
	for _, team := range teams {
		teamIDs = append(teamIDs, team.teamID)
	}
	homes, err := s.principalHomes(ctx, teamIDs)
	if err != nil {
		return nil, err
	}
	byHome := map[string][]string{}
	for _, teamID := range teamIDs {
		if home := homes[teamID]; home != "" && !slices.Contains(byHome[home], teamID) {
			byHome[home] = append(byHome[home], teamID)
		}
	}

	// The teams live in the platform project, not in the project the caller was
	// checked against, and that check already decided the caller may see this
	// list. These reads are the list's own lookups, so they skip the per-caller
	// list filter.
	loadCtx := WithAuthzListUnrestricted(ctx)
	refs := map[string]*TeamRef{}
	members := map[string][]string{}
	for home, ids := range byHome {
		loaded, err := s.loadTeams(loadCtx, home, ids)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to load admin teams")
		}
		for _, id := range ids {
			refs[id] = &TeamRef{TeamID: id}
			if team := loaded[id]; team != nil {
				refs[id] = teamRefFrom(team)
			}
		}
		edges, err := s.v2Pool.Statements().ListAuthzMembershipEdges(ctx, database.And(
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldProjectID), home),
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldSetType), domain.AuthzSetTypeTeam),
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberType), domain.AuthzMemberTypeUser),
			database.Or(equalIDFilters(domain.AuthzMembershipEdgeFieldSetID, ids)...),
		))
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to list admin team members")
		}
		for _, edge := range edges {
			members[edge.SetID] = append(members[edge.SetID], edge.MemberID)
		}
	}

	var out []sourcedAdmin
	for _, team := range teams {
		home := homes[team.teamID]
		if home == "" {
			continue
		}
		source := team.source
		source.Team = refs[team.teamID]
		for _, userID := range members[team.teamID] {
			out = append(out, sourcedAdmin{userID: userID, home: home, source: source})
		}
	}
	return out, nil
}

// activeAdminGrants returns the project's unrevoked, unexpired admin grants to
// principals of one type, in id order.
func (s *GrantService) activeAdminGrants(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType) ([]*domain.AuthzAssignment, error) {
	result, err := s.v2Pool.Statements().ListManagedGrants(ctx, projectID, &database.ListOptions[domain.AuthzAssignmentField]{
		Filter: database.And(
			database.StringEqual(database.Col(domain.AuthzAssignmentFieldRelation), domain.AuthzRelationAdmin),
			database.StringEqual(database.Col(domain.AuthzAssignmentFieldPrincipalType), principalType.String()),
			// Authorization ignores an expired grant, so this list does too.
			database.Or(
				database.Equal(database.Col(domain.AuthzAssignmentFieldExpiresAt), nil),
				database.GreaterThan(database.Col(domain.AuthzAssignmentFieldExpiresAt), time.Now()),
			),
		),
		Pagination: database.Page[domain.AuthzAssignmentField]{
			// Sorted for a stable source order; no limit, so the whole set is
			// read in one query.
			OrderBy: database.OrderBy[domain.AuthzAssignmentField]{
				Columns:   []database.Column[domain.AuthzAssignmentField]{database.Col(domain.AuthzAssignmentFieldID)},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list admin grants")
	}
	return result.Items, nil
}

// principalHomes returns the project each grant principal lives in, or "" for
// one that no longer exists. With a platform project pinned, every principal
// lives there.
func (s *GrantService) principalHomes(ctx context.Context, principalIDs []string) (map[string]string, error) {
	homes := make(map[string]string, len(principalIDs))
	for _, id := range principalIDs {
		if _, ok := homes[id]; ok {
			continue
		}
		if s.platformProjectID != "" {
			homes[id] = s.platformProjectID
			continue
		}
		scope, err := s.v2Pool.Statements().GetResourceScope(ctx, id)
		switch {
		case err == nil:
			homes[id] = scope.ProjectID
		case isNoRowFound(err):
			homes[id] = ""
		default:
			return nil, domain.ErrInternal(err).WithMessage("failed to resolve grant principal homes")
		}
	}
	return homes, nil
}

// resolveAdminRefs fills in each admin's user-ref, one batch per home project.
// An admin whose ref cannot be resolved keeps the bare user id.
func (s *GrantService) resolveAdminRefs(ctx context.Context, admins []*ProjectAdmin, homes map[string]string) error {
	byHome := map[string][]*ProjectAdmin{}
	for _, admin := range admins {
		home := homes[admin.User.UserID]
		byHome[home] = append(byHome[home], admin)
	}
	for home, homeAdmins := range byHome {
		userIDs := make([]string, 0, len(homeAdmins))
		for _, admin := range homeAdmins {
			userIDs = append(userIDs, admin.User.UserID)
		}
		refs, err := s.refs.ResolveUserRefs(ctx, home, userIDs)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to resolve admin user refs")
		}
		for _, admin := range homeAdmins {
			if ref, ok := refs[admin.User.UserID]; ok {
				admin.User = ref
			}
		}
	}
	return nil
}

func grantPrincipalIDs(grants []*domain.AuthzAssignment) []string {
	ids := make([]string, 0, len(grants))
	for _, grant := range grants {
		ids = append(ids, grant.PrincipalID)
	}
	return ids
}

// owningTeamGrantStatements reads a project's owning-team assignment.
type owningTeamGrantStatements interface {
	GetActiveOwningTeamGrant(ctx context.Context, projectID string) (*domain.AuthzAssignment, error)
}

// activeOwningTeamID returns the team that owns the project (ADR 054 §2), or ""
// when no team owns it. Like the resolver, it ignores an expired assignment.
func activeOwningTeamID(ctx context.Context, stmts owningTeamGrantStatements, projectID string) (string, error) {
	grant, err := stmts.GetActiveOwningTeamGrant(ctx, projectID)
	if err != nil {
		if isNoRowFound(err) {
			return "", nil
		}
		return "", domain.ErrInternal(err).WithMessage("failed to load the project's owning team")
	}
	if grant.ExpiresAt != nil && !grant.ExpiresAt.After(time.Now()) {
		return "", nil
	}
	return grant.PrincipalID, nil
}
