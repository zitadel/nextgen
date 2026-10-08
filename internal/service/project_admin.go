package service

import (
	"context"
	"encoding/base64"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
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

type ListProjectAdminsInput struct {
	ProjectID string
	// ViewerUserID is the caller, "" for a caller that is not a user.
	ViewerUserID string
	PageToken    string
	Limit        int
}

type ProjectAdmins struct {
	Admins        []*ProjectAdmin
	NextPageToken string
}

// projectAdminsPageToken is the opaque page token: the last user id listed.
type projectAdminsPageToken struct {
	After string `json:"after"`
}

// ListProjectAdmins lists the people who administer a project, ordered by user
// id, as the viewer may see them.
//
// Viewers see a person in full only through a direct grant, which the grants
// list shows anyway, or through a team the viewer is a member of. Anyone else
// is listed by user id, and a team the viewer is not in by team id: an admin
// grant can name any platform team, and listing its members must not reveal
// more than the viewer could otherwise see.
func (s *GrantService) ListProjectAdmins(ctx context.Context, input ListProjectAdminsInput) (*ProjectAdmins, error) {
	if input.ProjectID == "" {
		return nil, domain.ErrProjectMissingID()
	}
	var after string
	if input.PageToken != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(input.PageToken)
		var token projectAdminsPageToken
		if err != nil || json.Unmarshal(decoded, &token) != nil || token.After == "" {
			return nil, domain.ErrRequestInvalid().WithDetails("invalid page token")
		}
		after = token.After
	}
	limit := normalizeLimit(input.Limit)
	// One person more than the page holds tells whether another page follows.
	rows, err := s.v2Pool.Statements().ListProjectAdminSources(ctx, input.ProjectID, after, input.ViewerUserID, uint32(limit+1))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list project admins")
	}

	var admins []*ProjectAdmin
	homes := map[string]string{}
	visible := map[string]bool{}
	for _, row := range rows {
		if len(admins) == 0 || admins[len(admins)-1].User.UserID != row.UserID {
			admins = append(admins, &ProjectAdmin{User: domain.UserRef{UserID: row.UserID}})
			homes[row.UserID] = row.HomeProjectID
		}
		source := ProjectAdminSource{Type: ProjectAdminSourceGrant, GrantID: row.GrantID}
		if row.OwningTeam {
			source.Type = ProjectAdminSourceOwningTeam
		}
		if row.TeamID != "" {
			source.Team = &TeamRef{TeamID: row.TeamID, Name: row.TeamName}
		}
		visible[row.UserID] = visible[row.UserID] || row.Visible
		admin := admins[len(admins)-1]
		admin.Sources = append(admin.Sources, source)
	}
	out := &ProjectAdmins{Admins: admins}
	if len(admins) > limit {
		out.Admins = admins[:limit]
		payload, err := json.Marshal(projectAdminsPageToken{After: admins[limit-1].User.UserID})
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to build the page token")
		}
		out.NextPageToken = base64.RawURLEncoding.EncodeToString(payload)
	}

	var shown []*ProjectAdmin
	for _, admin := range out.Admins {
		if visible[admin.User.UserID] {
			shown = append(shown, admin)
		}
	}
	if err := s.resolveAdminRefs(ctx, shown, homes); err != nil {
		return nil, err
	}
	return out, nil
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
