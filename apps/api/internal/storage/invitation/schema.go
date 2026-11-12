package invitation

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds invitation list/filter/order fields for all dialects. The
// type's object, the metadata and the token hash are read off the row by
// ToDomain and never filtered on through the list.
var Schema = database.NewSchema(map[domain.InvitationField]database.FieldBinding[domain.Invitation]{
	domain.InvitationFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(i *domain.Invitation) any { return i.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.InvitationFieldID: {
		SQLName:  "id",
		Accessor: func(i *domain.Invitation) any { return i.ID },
		Coerce:   database.CoerceString,
	},
	domain.InvitationFieldType: {
		SQLName:  "type",
		Accessor: func(i *domain.Invitation) any { return string(i.Type) },
		Coerce:   database.CoerceString,
	},
	domain.InvitationFieldStatus: {
		SQLName:  "status",
		Accessor: func(i *domain.Invitation) any { return string(i.Status) },
		Coerce:   database.CoerceString,
	},
	domain.InvitationFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(i *domain.Invitation) any { return i.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.InvitationFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(i *domain.Invitation) any { return i.ExpiresAt },
		Coerce:   database.CoerceTime,
	},
})
