package authz

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// AuthzAssignmentSchema binds authz_assignments filter and cursor fields for
// all dialects. expires_at is nullable so a NULL cursor value must keep paging
// rather than dropping the remaining rows (#766).
var AuthzAssignmentSchema = database.NewSchema(map[domain.AuthzAssignmentField]database.FieldBinding[domain.AuthzAssignment]{
	domain.AuthzAssignmentFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(a *domain.AuthzAssignment) any { return a.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldID: {
		SQLName:  "id",
		Accessor: func(a *domain.AuthzAssignment) any { return a.ID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldPrincipalType: {
		SQLName:  "principal_type",
		Accessor: func(a *domain.AuthzAssignment) any { return a.PrincipalType.String() },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldPrincipalID: {
		SQLName:  "principal_id",
		Accessor: func(a *domain.AuthzAssignment) any { return a.PrincipalID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldRelation: {
		SQLName:  "relation",
		Accessor: func(a *domain.AuthzAssignment) any { return a.Relation },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(a *domain.AuthzAssignment) any { return a.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.AuthzAssignmentFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(a *domain.AuthzAssignment) any { return database.NullableValue(a.ExpiresAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
})
