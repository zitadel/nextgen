package user

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pattern"
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

// SchemaSQL is what the user schema binding needs from one dialect.
type SchemaSQL struct {
	UsersTable                string
	JSONSchemasTable          string
	UserAttributesTable       string
	UserUniqueAttributesTable string
	// AttributeString reads a.value as text when it holds a JSON string, so a
	// value matches as it was written rather than as its encoding, and is NULL
	// for any other JSON type, whose text differs by dialect.
	AttributeString string
	// LikeEscape follows a LIKE on a dialect with no default escape character.
	LikeEscape string
}

// NewSchema binds user list/filter/order fields for one dialect's SQL.
// SchemaObjectType is the object type of the user's schema, read from the
// schema row. It reads as "" for a schema without an object type and, on
// dialects without a users-to-schemas foreign key, for a missing schema row,
// so not_equals still matches those users.
//
// IdentifierHash compares through the unique-attributes registry, the one
// comparison identifier resolution uses (ADR 058 §4a). Naming team_id, empty
// for the project scope every x-identifier carries, makes this a primary key
// seek for each user: leaving it out is what makes the sign-in lookup quadratic
// (#2377). IdentifierContains cannot use the registry, which holds only hashes,
// so it reads the attribute row. Both match string values only: the registry
// holds a number's hash, which no string filter value can equal, and the
// attribute row gives contains the same answer.
func NewSchema(dialect SchemaSQL) database.Schema[domain.UserField, domain.User] {
	usersTable, jsonSchemasTable := dialect.UsersTable, dialect.JSONSchemasTable
	return database.NewSchema(map[domain.UserField]database.FieldBinding[domain.User]{
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
			SQLName:  "lifecycle_owner_team_id",
			Accessor: func(u *domain.User) any { return database.NullableValue(u.LifecycleOwnerTeamID) },
			Coerce:   database.CoerceString,
			Nullable: true,
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
		domain.UserFieldSchemaObjectType: {
			SQLName: `COALESCE((SELECT s.object_type FROM ` + jsonSchemasTable + ` s` +
				` WHERE s.project_id = ` + usersTable + `.project_id AND s.url = ` + usersTable + `.schema_url), '')`,
			Computed: true,
		},
		domain.UserFieldIdentifierHash: {
			SQLName: `EXISTS (SELECT 1 FROM ` + dialect.UserUniqueAttributesTable + ` ua` +
				` WHERE ua.project_id = ` + usersTable + `.project_id AND ua.user_id = ` + usersTable + `.id` +
				` AND ua.team_id = '' AND ua.key = `,
			SQLBetween: []string{` AND ua.value_hash = `},
			SQLSuffix:  `)`,
			Computed:   true,
		},
		domain.UserFieldIdentifierContains: {
			SQLName: `EXISTS (SELECT 1 FROM ` + dialect.UserAttributesTable + ` a` +
				` WHERE a.project_id = ` + usersTable + `.project_id AND a.user_id = ` + usersTable + `.id` +
				` AND a.key = `,
			SQLBetween: []string{` AND LOWER(` + dialect.AttributeString + `) LIKE LOWER(`},
			SQLSuffix:  `)` + dialect.LikeEscape + `)`,
			Computed:   true,
		},
	})
}

// IdentifierEqual matches users whose designated identifier property key holds
// the string value, under the comparison sign-in uses: case-folded.
func IdentifierEqual(key, value string) (database.Filter[domain.UserField], error) {
	hash, err := domain.UniqueValueHash(value)
	if err != nil {
		return nil, fmt.Errorf("hash identifier: %w", err)
	}
	return database.CorrelatedEqual(database.Col(domain.UserFieldIdentifierHash), key, hash[:]), nil
}

// IdentifierContains matches users whose designated identifier property key
// holds a string with value anywhere in it, ignoring case as far as the
// database's LOWER folds it.
func IdentifierContains(key, value string) database.Filter[domain.UserField] {
	return database.CorrelatedEqual(database.Col(domain.UserFieldIdentifierContains), key, "%"+pattern.EscapeLikePattern(value)+"%")
}
