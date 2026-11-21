package service

import (
	"context"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type ProjectMember struct {
	User domain.UserRef
	// Relation is the person's strongest role on the project.
	Relation string
	// Sources are the ways the person holds Relation.
	Sources []domain.ProjectMemberSourceRecord
}

type ListProjectMembersInput struct {
	ProjectID string
	// MinRelation keeps the people whose strongest role is at least this
	// strong, "" for everyone.
	MinRelation string
	PageToken   string
	Limit       int
}

type ProjectMembers struct {
	Members       []*ProjectMember
	NextPageToken string
}

func (s *GrantService) ListProjectMembers(ctx context.Context, input ListProjectMembersInput) (_ *ProjectMembers, err error) {
	ctx, end := startSpan(ctx, "GrantService.ListProjectMembers")
	defer end(&err)

	if input.ProjectID == "" {
		return nil, domain.ErrProjectMissingID()
	}
	if input.MinRelation != "" && !slices.Contains(domain.ProjectRoles, input.MinRelation) {
		return nil, domain.ErrRequestInvalid().WithMessage("relation must be viewer, editor or admin")
	}
	page := database.Page[domain.ProjectMemberField]{
		Limit: uint32(normalizeLimit(input.Limit)),
		OrderBy: database.OrderBy[domain.ProjectMemberField]{
			Columns:   []database.Column[domain.ProjectMemberField]{database.Col(domain.ProjectMemberFieldUserID)},
			Direction: database.OrderAsc,
		},
	}
	if input.PageToken != "" {
		page.Cursor = []byte(input.PageToken)
	}
	listed, err := s.v2Pool.Statements().ListProjectMembers(ctx, input.ProjectID, input.MinRelation, page)
	if err != nil {
		return nil, mapListError(err, "failed to list project members")
	}
	out := &ProjectMembers{NextPageToken: string(listed.NextCursor)}

	byHome := map[string][]*ProjectMember{}
	for _, record := range listed.Items {
		member := &ProjectMember{User: domain.UserRef{UserID: record.UserID}, Relation: record.Relation, Sources: record.Sources}
		out.Members = append(out.Members, member)
		byHome[record.HomeProjectID] = append(byHome[record.HomeProjectID], member)
	}

	if err := s.resolveMemberRefs(ctx, byHome); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *GrantService) resolveMemberRefs(ctx context.Context, byHome map[string][]*ProjectMember) error {
	for home, homeMembers := range byHome {
		userIDs := make([]string, 0, len(homeMembers))
		for _, member := range homeMembers {
			userIDs = append(userIDs, member.User.UserID)
		}
		refs, err := s.refs.ResolveUserRefs(ctx, home, userIDs)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to resolve member user refs")
		}
		for _, member := range homeMembers {
			if ref, ok := refs[member.User.UserID]; ok {
				member.User = ref
			}
		}
	}
	return nil
}
