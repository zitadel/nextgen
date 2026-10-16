package userattribute

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds user attribute list/filter/order fields for all dialects. The
// read joins each attribute to its unique-attributes registry claim, so the
// columns are qualified: a is the attribute, ua the claim.
var Schema = database.NewSchema(map[domain.UserAttributeField]database.FieldBinding[domain.UserAttribute]{
	domain.UserAttributeFieldProjectID: {
		SQLName:  "a.project_id",
		Accessor: func(a *domain.UserAttribute) any { return a.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserAttributeFieldUserID: {
		SQLName:  "a.user_id",
		Accessor: func(a *domain.UserAttribute) any { return a.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserAttributeFieldTeamID: {
		SQLName:  "a.team_id",
		Accessor: func(a *domain.UserAttribute) any { return a.TeamID },
		Coerce:   database.CoerceString,
	},
	domain.UserAttributeFieldKey: {
		SQLName:  "a.key",
		Accessor: func(a *domain.UserAttribute) any { return string(a.Key) },
		Coerce:   database.CoerceString,
	},
	domain.UserAttributeFieldUniqueTeamID: {
		SQLName:  "ua.team_id",
		Accessor: func(a *domain.UserAttribute) any { return database.NullableValue(a.UniqueTeamID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.UserAttributeFieldValueHash: {
		SQLName:  "ua.value_hash",
		Accessor: func(a *domain.UserAttribute) any { return a.ValueHash },
		Coerce:   database.CoerceBytes,
		Nullable: true,
	},
})
