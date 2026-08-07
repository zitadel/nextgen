package usertotp

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Schema binds user TOTP list/filter/order fields for both dialects.
var Schema = database.NewSchema(map[domain.UserTOTPField]database.FieldBinding[domain.UserTOTP]{
	domain.UserTOTPFieldID: {
		SQLName:  "id",
		Accessor: func(t *domain.UserTOTP) any { return t.ID },
		Coerce:   database.CoerceString,
	},
	domain.UserTOTPFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(t *domain.UserTOTP) any { return t.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserTOTPFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(t *domain.UserTOTP) any { return t.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserTOTPFieldSecret: {
		SQLName:  "secret",
		Accessor: func(t *domain.UserTOTP) any { return t.Secret },
		Coerce:   database.CoerceBytes,
	},
	domain.UserTOTPFieldVerifiedAt: {
		SQLName: "verified_at",
		// verified_at is NULL until the TOTP is verified; the zero time is never stored.
		Accessor: func(t *domain.UserTOTP) any {
			if t.VerifiedAt.IsZero() {
				return nil
			}
			return t.VerifiedAt
		},
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.UserTOTPFieldLastSuccessfulCheck: {
		SQLName:  "last_successful_check",
		Accessor: func(t *domain.UserTOTP) any { return database.NullableValue(t.LastSuccessfulCheck) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.UserTOTPFieldFailedAttempts: {
		SQLName:  "failed_attempts",
		Accessor: func(t *domain.UserTOTP) any { return t.FailedAttempts },
		Coerce:   database.CoerceNumber[int16],
	},
	domain.UserTOTPFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(t *domain.UserTOTP) any { return t.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserTOTPFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(t *domain.UserTOTP) any { return t.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
