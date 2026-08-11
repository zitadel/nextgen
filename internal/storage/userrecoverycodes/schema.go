package userrecoverycodes

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds recovery-codes list/filter/order fields for both dialects.
var Schema = database.NewSchema(map[domain.UserRecoveryCodesField]database.FieldBinding[domain.UserRecoveryCodes]{
	domain.UserRecoveryCodesFieldID: {
		SQLName:  "id",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.ID },
		Coerce:   database.CoerceString,
	},
	domain.UserRecoveryCodesFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserRecoveryCodesFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserRecoveryCodesFieldRecoveryCodes: {
		SQLName:  "recovery_codes",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.RecoveryCodes },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
	domain.UserRecoveryCodesFieldLastSuccessfulCheck: {
		SQLName:  "last_successful_check",
		Accessor: func(c *domain.UserRecoveryCodes) any { return database.NullableValue(c.LastSuccessfulCheck) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.UserRecoveryCodesFieldFailedAttempts: {
		SQLName:  "failed_attempts",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.FailedAttempts },
		Coerce:   database.CoerceNumber[int16],
	},
	domain.UserRecoveryCodesFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserRecoveryCodesFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
