package userattribute

import (
	"encoding/base64"

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
	domain.UserAttributeFieldUniqueKey: {
		SQLName:  "ua.key",
		Accessor: func(a *domain.UserAttribute) any { return uniqueKey(a) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.UserAttributeFieldValueHash: {
		SQLName:  "ua.value_hash",
		Accessor: func(a *domain.UserAttribute) any { return valueHash(a) },
		Coerce:   coerceValueHash,
		Nullable: true,
	},
})

// uniqueKey is the claim's key, nil when the attribute has no claim.
func uniqueKey(a *domain.UserAttribute) any {
	if a.UniqueTeamID == nil {
		return nil
	}
	return string(a.Key)
}

// valueHash is the claim's value hash, nil when the attribute has no claim.
func valueHash(a *domain.UserAttribute) any {
	if a.ValueHash == nil {
		return nil
	}
	return a.ValueHash
}

// coerceValueHash binds a value hash. A cursor carries it as JSON, which
// encodes bytes as base64, and a row without a claim as null.
func coerceValueHash(v any) (any, error) {
	switch b := v.(type) {
	case nil:
		return nil, nil
	case []byte:
		return b, nil
	case string:
		decoded, err := base64.StdEncoding.DecodeString(b)
		if err != nil {
			return nil, database.ErrCoerceExpectedType("base64 value hash", v)
		}
		return decoded, nil
	default:
		return nil, database.ErrCoerceExpectedType("value hash", v)
	}
}
