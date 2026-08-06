// Package userteam binds the user roster read: team memberships joined to the
// teams they point at.
package userteam

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Schema binds user-team list/filter/order fields for all dialects.
//
// The SQL names are table-qualified because the read is a join and every
// dialect aliases the membership table `m` and the team table `t`: `project_id`,
// `status`, and `created_at` exist on both sides, so an unqualified name would
// be ambiguous.
var Schema = database.NewSchema(map[domain.UserTeamField]database.FieldBinding[domain.UserTeam]{
	domain.UserTeamFieldProjectID: {
		SQLName:  "m.project_id",
		Accessor: func(t *domain.UserTeam) any { return t.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserTeamFieldUserID: {
		SQLName:  "m.user_id",
		Accessor: func(t *domain.UserTeam) any { return t.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserTeamFieldTeamID: {
		SQLName:  "m.team_id",
		Accessor: func(t *domain.UserTeam) any { return t.TeamID },
		Coerce:   database.CoerceString,
	},
	domain.UserTeamFieldTeamName: {
		SQLName:  "t.name",
		Accessor: func(t *domain.UserTeam) any { return t.TeamName },
		Coerce:   database.CoerceString,
	},
	domain.UserTeamFieldStatus: {
		SQLName:  "m.status",
		Accessor: func(t *domain.UserTeam) any { return t.Status.String() },
		Coerce:   database.CoerceString,
	},
	domain.UserTeamFieldCreatedAt: {
		SQLName:  "m.created_at",
		Accessor: func(t *domain.UserTeam) any { return t.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserTeamFieldUpdatedAt: {
		SQLName:  "m.updated_at",
		Accessor: func(t *domain.UserTeam) any { return t.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
