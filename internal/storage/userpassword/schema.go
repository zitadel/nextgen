package userpassword

import (
	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
)

// Schema binds user password list/filter/order fields for both dialects.
var Schema = database.NewSchema(map[domain.UserPasswordField]database.FieldBinding[domain.UserPassword]{
	domain.UserPasswordFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.UserPassword) any { return p.ID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasswordFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(p *domain.UserPassword) any { return p.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasswordFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(p *domain.UserPassword) any { return p.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasswordFieldEncodedHash: {
		SQLName:  "encoded_hash",
		Accessor: func(p *domain.UserPassword) any { return p.EncodedHash },
		Coerce:   database.CoerceString,
	},
	domain.UserPasswordFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.UserPassword) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
