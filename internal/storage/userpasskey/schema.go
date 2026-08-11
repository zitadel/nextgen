package userpasskey

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds user passkey list/filter/order fields for both dialects.
var Schema = database.NewSchema(map[domain.UserPasskeyField]database.FieldBinding[domain.UserPasskey]{
	domain.UserPasskeyFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.UserPasskey) any { return p.ID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(p *domain.UserPasskey) any { return p.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(p *domain.UserPasskey) any { return p.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldCredentialID: {
		SQLName:  "credential_id",
		Accessor: func(p *domain.UserPasskey) any { return p.CredentialID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldSignCount: {
		SQLName:  "sign_count",
		Accessor: func(p *domain.UserPasskey) any { return p.SignCount },
		Coerce:   database.CoerceNumber[int64],
	},
	domain.UserPasskeyFieldBackupEligible: {
		SQLName:  "backup_eligible",
		Accessor: func(p *domain.UserPasskey) any { return p.BackupEligible },
		Coerce:   database.CoerceBool,
	},
	domain.UserPasskeyFieldBackupState: {
		SQLName:  "backup_state",
		Accessor: func(p *domain.UserPasskey) any { return p.BackupState },
		Coerce:   database.CoerceBool,
	},
	domain.UserPasskeyFieldName: {
		SQLName: "name",
		// name is NULL only for rows written outside the product path; the
		// registration flow generates a name when none is given, so "" is
		// never stored.
		Accessor: func(p *domain.UserPasskey) any {
			if p.Name == "" {
				return nil
			}
			return p.Name
		},
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.UserPasskeyFieldVerifiedAt: {
		SQLName:  "verified_at",
		Accessor: func(p *domain.UserPasskey) any { return database.NullableValue(p.VerifiedAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.UserPasskeyFieldLastUsedAt: {
		SQLName:  "last_used_at",
		Accessor: func(p *domain.UserPasskey) any { return database.NullableValue(p.LastUsedAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.UserPasskeyFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.UserPasskey) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserPasskeyFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(p *domain.UserPasskey) any { return p.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
