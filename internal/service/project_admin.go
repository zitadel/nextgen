package service

import (
	"context"

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

func (s *GrantService) ListProjectAdmins(ctx context.Context, input ListProjectAdminsInput) (*ProjectAdmins, error) {
	if input.ProjectID == "" {
		return nil, domain.ErrProjectMissingID()
	}
	page := database.Page[domain.ProjectAdminField]{
		Limit: uint32(normalizeLimit(input.Limit)),
		OrderBy: database.OrderBy[domain.ProjectAdminField]{
			Columns:   []database.Column[domain.ProjectAdminField]{database.Col(domain.ProjectAdminFieldUserID)},
			Direction: database.OrderAsc,
		},
	}
	if input.PageToken != "" {
		page.Cursor = []byte(input.PageToken)
	}
	listed, err := s.v2Pool.Statements().ListProjectAdmins(ctx, input.ProjectID, input.ViewerUserID, page)
	if err != nil {
		return nil, mapListError(err, "failed to list project admins")
	}
	out := &ProjectAdmins{NextPageToken: string(listed.NextCursor)}

	homes := map[string]string{}
	for _, record := range listed.Items {
		out.Admins = append(out.Admins, projectAdminFromRecord(record))
		homes[record.UserID] = record.HomeProjectID
	}

	if err := s.resolveAdminRefs(ctx, out.Admins, homes); err != nil {
		return nil, err
	}
	return out, nil
}

func projectAdminFromRecord(record *domain.ProjectAdminRecord) *ProjectAdmin {
	admin := &ProjectAdmin{User: domain.UserRef{UserID: record.UserID}}
	for _, source := range record.Sources {
		mapped := ProjectAdminSource{Type: ProjectAdminSourceGrant, GrantID: source.GrantID}
		if source.OwningTeam {
			mapped.Type = ProjectAdminSourceOwningTeam
		}
		if source.TeamID != "" {
			mapped.Team = &TeamRef{TeamID: source.TeamID, Name: source.TeamName}
		}
		admin.Sources = append(admin.Sources, mapped)
	}
	return admin
}

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
