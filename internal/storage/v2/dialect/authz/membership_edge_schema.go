package authz

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// MembershipEdgeSchema binds authz_membership_edges filter fields for all dialects.
var MembershipEdgeSchema = database.NewSchema(map[domain.AuthzMembershipEdgeField]database.FieldBinding[domain.AuthzMembershipEdge]{
	domain.AuthzMembershipEdgeFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(e *domain.AuthzMembershipEdge) any { return e.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzMembershipEdgeFieldMemberType: {
		SQLName:  "member_type",
		Accessor: func(e *domain.AuthzMembershipEdge) any { return e.MemberType.String() },
		Coerce:   database.CoerceString,
	},
	domain.AuthzMembershipEdgeFieldMemberID: {
		SQLName:  "member_id",
		Accessor: func(e *domain.AuthzMembershipEdge) any { return e.MemberID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzMembershipEdgeFieldSetType: {
		SQLName:  "set_type",
		Accessor: func(e *domain.AuthzMembershipEdge) any { return e.SetType.String() },
		Coerce:   database.CoerceString,
	},
	domain.AuthzMembershipEdgeFieldSetID: {
		SQLName:  "set_id",
		Accessor: func(e *domain.AuthzMembershipEdge) any { return e.SetID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzMembershipEdgeFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(e *domain.AuthzMembershipEdge) any { return e.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
