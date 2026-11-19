package oauthsettings

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds the OAuth settings list/filter/order fields for every
// dialect. The content lives in the definition JSON column and is handled by
// Marshal/ToDomain, not as list Schema columns.
var Schema = database.NewSchema(map[domain.OAuthSettingsField]database.FieldBinding[domain.OAuthSettings]{
	domain.OAuthSettingsFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(s *domain.OAuthSettings) any { return s.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.OAuthSettingsFieldID: {
		SQLName:  "id",
		Accessor: func(s *domain.OAuthSettings) any { return s.ID },
		Coerce:   database.CoerceString,
	},
	domain.OAuthSettingsFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(s *domain.OAuthSettings) any { return s.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
