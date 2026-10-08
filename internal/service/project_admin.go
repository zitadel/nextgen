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
	records, err := s.v2Pool.Statements().ListProjectAdmins(ctx, input.ProjectID, after, input.ViewerUserID, uint32(limit+1))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list project admins")
	}
	out := &ProjectAdmins{}
	if len(records) > limit {
		records = records[:limit]
		payload, err := json.Marshal(projectAdminsPageToken{After: records[limit-1].UserID})
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to build the page token")
		}
		out.NextPageToken = base64.RawURLEncoding.EncodeToString(payload)
	}

	homes := map[string]string{}
	for _, record := range records {
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
