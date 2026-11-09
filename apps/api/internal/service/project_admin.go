package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type ProjectAdmin struct {
	User    domain.UserRef
	Sources []domain.ProjectAdminSourceRecord
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

func (s *GrantService) ListProjectAdmins(ctx context.Context, input ListProjectAdminsInput) (_ *ProjectAdmins, err error) {
	ctx, end := startSpan(ctx, "GrantService.ListProjectAdmins")
	defer end(&err)

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

	byHome := map[string][]*ProjectAdmin{}
	for _, record := range listed.Items {
		admin := &ProjectAdmin{User: domain.UserRef{UserID: record.UserID}, Sources: record.Sources}
		out.Admins = append(out.Admins, admin)
		byHome[record.HomeProjectID] = append(byHome[record.HomeProjectID], admin)
	}

	if err := s.resolveAdminRefs(ctx, byHome); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *GrantService) resolveAdminRefs(ctx context.Context, byHome map[string][]*ProjectAdmin) error {
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
