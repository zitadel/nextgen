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

// sourcedAdmin is one person's admin access through one source.
type sourcedAdmin struct {
	userID string
	home   string
	source ProjectAdminSource
}

// ListProjectAdmins lists the people who administer a project, ordered by user
// id.
//
// It is not paginated: the sources live in different tables, so the list is
// built whole on every call, and the people who administer one project are
// few.
func (s *GrantService) ListProjectAdmins(ctx context.Context, projectID string) ([]*ProjectAdmin, error) {
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
	if err := s.resolveAdminRefs(ctx, admins, homes); err != nil {
		return nil, err
	}
	return slices.SortedFunc(maps.Values(admins), func(a, b *ProjectAdmin) int {
		return strings.Compare(a.User.UserID, b.User.UserID)
	}), nil
}

func (s *GrantService) owningTeamAdmins(ctx context.Context, projectID string) ([]sourcedAdmin, error) {
	owning, err := s.v2Pool.Statements().GetActiveOwningTeamGrant(ctx, projectID)
	if err != nil {
		if isNoRowFound(err) {
			return nil, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to load the project's owning team")
	}
	return s.teamAdmins(ctx, owning.PrincipalID, ProjectAdminSource{Type: ProjectAdminSourceOwningTeam})
}

func (s *GrantService) teamGrantAdmins(ctx context.Context, projectID string) ([]sourcedAdmin, error) {
	grants, err := s.activeAdminGrants(ctx, projectID, domain.AuthzPrincipalTypeTeam)
	if err != nil {
		return nil, err
	}
	var out []sourcedAdmin
	for _, grant := range grants {
		members, err := s.teamAdmins(ctx, grant.PrincipalID, ProjectAdminSource{Type: ProjectAdminSourceGrant, GrantID: grant.ID})
		if err != nil {
			return nil, err
		}
		out = append(out, members...)
	}
	return out, nil
}

func (s *GrantService) userGrantAdmins(ctx context.Context, projectID string) ([]sourcedAdmin, error) {
	grants, err := s.activeAdminGrants(ctx, projectID, domain.AuthzPrincipalTypeUser)
	if err != nil {
		return nil, err
	}
	out := make([]sourcedAdmin, 0, len(grants))
	for _, grant := range grants {
		home, err := s.principalHome(ctx, grant.PrincipalID)
		if err != nil {
			return nil, err
		}
		if home == "" {
			continue
		}
		out = append(out, sourcedAdmin{
			userID: grant.PrincipalID,
			home:   home,
			source: ProjectAdminSource{Type: ProjectAdminSourceGrant, GrantID: grant.ID},
		})
	}
	return out, nil
}

func (s *GrantService) teamAdmins(ctx context.Context, teamID string, source ProjectAdminSource) ([]sourcedAdmin, error) {
	home, err := s.principalHome(ctx, teamID)
	if err != nil || home == "" {
		return nil, err
	}
	// The team and its members live in the platform project, not in the
	// project the caller was checked against, and that check already decided
	// the caller may see this list. These reads are the list's own lookups, so
	// they skip the per-caller list filter.
	ctx = WithAuthzListUnrestricted(ctx)
	teams, err := s.loadTeams(ctx, home, []string{teamID})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to load an admin team")
	}
	source.Team = &TeamRef{TeamID: teamID}
	if team := teams[teamID]; team != nil {
		source.Team = teamRefFrom(team)
	}
	members, err := s.activeTeamMemberIDs(ctx, home, teamID)
	if err != nil {
		return nil, err
	}
	out := make([]sourcedAdmin, 0, len(members))
	for _, userID := range members {
		out = append(out, sourcedAdmin{userID: userID, home: home, source: source})
	}
	return out, nil
}

func (s *GrantService) activeAdminGrants(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType) ([]*domain.AuthzAssignment, error) {
	result, err := s.v2Pool.Statements().ListManagedGrants(ctx, projectID, &database.ListOptions[domain.AuthzAssignmentField]{
		Filter: database.And(
			database.StringEqual(database.Col(domain.AuthzAssignmentFieldRelation), domain.AuthzRelationAdmin),
			database.StringEqual(database.Col(domain.AuthzAssignmentFieldPrincipalType), principalType.String()),
		),
		Pagination: database.Page[domain.AuthzAssignmentField]{
			OrderBy: database.OrderBy[domain.AuthzAssignmentField]{
				Columns:   []database.Column[domain.AuthzAssignmentField]{database.Col(domain.AuthzAssignmentFieldID)},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list admin grants")
	}
	now := time.Now()
	return slices.DeleteFunc(result.Items, func(grant *domain.AuthzAssignment) bool {
		return grant.ExpiresAt != nil && !grant.ExpiresAt.After(now)
	}), nil
}

func (s *GrantService) activeTeamMemberIDs(ctx context.Context, projectID, teamID string) ([]string, error) {
	result, err := s.v2Pool.Statements().ListUsers(ctx, &database.ListOptions[domain.UserField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserFieldStatus), domain.UserStatusActive.String()),
		),
	}, UserQueryOptions{MembershipTeamID: &teamID})
	if err != nil {
		return nil, mapListError(err, "failed to list admin team members")
	}
	ids := make([]string, 0, len(result.Items))
	for _, user := range result.Items {
		ids = append(ids, user.ID)
	}
	return ids, nil
}

func (s *GrantService) principalHome(ctx context.Context, principalID string) (string, error) {
	if s.platformProjectID != "" {
		return s.platformProjectID, nil
	}
	scope, err := s.v2Pool.Statements().GetResourceScope(ctx, principalID)
	if err != nil {
		if isNoRowFound(err) {
			return "", nil
		}
		return "", domain.ErrInternal(err).WithMessage("failed to resolve an admin's home project")
	}
	return scope.ProjectID, nil
}

func (s *GrantService) resolveAdminRefs(ctx context.Context, admins map[string]*ProjectAdmin, homes map[string]string) error {
	byHome := map[string][]string{}
	for userID, home := range homes {
		byHome[home] = append(byHome[home], userID)
	}
	for home, userIDs := range byHome {
		refs, err := s.refs.ResolveUserRefs(ctx, home, userIDs)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to resolve admin user refs")
		}
		for userID, ref := range refs {
			admins[userID].User = ref
		}
	}
	return nil
}
