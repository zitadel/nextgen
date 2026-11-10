package user

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
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
	// TablePrefix qualifies every table name on a dialect that uses a schema.
	TablePrefix string
}

// NewSchema binds user list/filter/order fields for one dialect's SQL.
// SchemaObjectType is the object type of the user's schema, read from the
// schema row. It reads as "" for a schema without an object type and, on
// dialects without a users-to-schemas foreign key, for a missing schema row,
// so not_equals still matches those users.
//
// The two search fields name the columns a search read joins in (see
// search.go), so they sort and resume such a read and nothing else.
func NewSchema(dialect SchemaSQL) database.Schema[domain.UserField, domain.User] {
	usersTable, jsonSchemasTable := dialect.TablePrefix+"users", dialect.TablePrefix+"json_schemas"
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
		domain.UserFieldSearchText: {
			SQLName:  SearchTextColumn,
			Accessor: func(u *domain.User) any { return u.MatchedText },
			Coerce:   database.CoerceString,
			Computed: true,
		},
		domain.UserFieldSearchUserID: {
			SQLName:  SearchUserIDColumn,
			Accessor: func(u *domain.User) any { return u.ID },
			Coerce:   database.CoerceString,
			Computed: true,
		},
	})
}
