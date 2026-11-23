package oauthsettings

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewestFirst is created_at DESC, id DESC. The id breaks created_at ties
// deterministically when revisions share the same timestamp.
func NewestFirst() database.OrderBy[domain.OAuthSettingsField] {
	return database.OrderBy[domain.OAuthSettingsField]{
		Columns: []database.Column[domain.OAuthSettingsField]{
			database.Col(domain.OAuthSettingsFieldCreatedAt),
			database.Col(domain.OAuthSettingsFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ListOptions returns options for listing a project's OAuth settings
// revisions, newest first, capped at limit.
func ListOptions(projectID string, limit uint32) *database.ListOptions[domain.OAuthSettingsField] {
	return &database.ListOptions[domain.OAuthSettingsField]{
		Filter: database.Equal(database.Col(domain.OAuthSettingsFieldProjectID), projectID),
		Pagination: database.Page[domain.OAuthSettingsField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}
