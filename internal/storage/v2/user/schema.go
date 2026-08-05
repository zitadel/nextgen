package user

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func coerceUserStatus(v any) (any, error) {
	switch t := v.(type) {
	case domain.UserStatus:
		return t.String(), nil
	case string:
		return t, nil
	default:
		return nil, database.ErrCoerceExpectedType("user status", v)
	}
}

// Schema binds user list/filter/order fields for both dialects.
var Schema = database.NewSchema(map[domain.UserField]database.FieldBinding[domain.User]{
	domain.UserFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(u *domain.User) any { return u.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserFieldID: {
		SQLName:  "id",
		Accessor: func(u *domain.User) any { return u.ID },
		Coerce:   database.CoerceString,
	},
	domain.UserFieldSchemaURL: {
		SQLName:  "schema_url",
		Accessor: func(u *domain.User) any { return u.SchemaURL },
		Coerce:   database.CoerceString,
	},
	domain.UserFieldLifecycleOwnerTeamID: {
		SQLName: "lifecycle_owner_team_id",
		Accessor: func(u *domain.User) any {
			if u.LifecycleOwnerTeamID == nil {
				return ""
			}
			return *u.LifecycleOwnerTeamID
		},
		Coerce: database.CoerceString,
	},
	domain.UserFieldStatus: {
		SQLName:  "status",
		Accessor: func(u *domain.User) any { return u.Metadata.Status.String() },
		Coerce:   coerceUserStatus,
	},
	domain.UserFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(u *domain.User) any { return u.Metadata.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(u *domain.User) any { return u.Metadata.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
