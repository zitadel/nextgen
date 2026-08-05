package teammembership

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Schema binds team membership list/filter/order fields for both dialects.
var Schema = database.NewSchema(map[domain.TeamMembershipField]database.FieldBinding[domain.TeamMembership]{
	domain.TeamMembershipFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(m *domain.TeamMembership) any { return m.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.TeamMembershipFieldTeamID: {
		SQLName:  "team_id",
		Accessor: func(m *domain.TeamMembership) any { return m.TeamID },
		Coerce:   database.CoerceString,
	},
	domain.TeamMembershipFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(m *domain.TeamMembership) any { return m.UserID },
		Coerce:   database.CoerceString,
	},
	domain.TeamMembershipFieldStatus: {
		SQLName:  "status",
		Accessor: func(m *domain.TeamMembership) any { return m.Status.String() },
		Coerce:   database.CoerceString,
	},
	domain.TeamMembershipFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(m *domain.TeamMembership) any { return m.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.TeamMembershipFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(m *domain.TeamMembership) any { return m.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
