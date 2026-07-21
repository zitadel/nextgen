package repository

// Shared table names used by remaining v1 repositories that touch the
// team/membership graph (users, team_memberships). Team storage itself lives
// in storage/v2 statements.
const (
	pgTableMemberships  = "zitadel_nextgen.team_memberships"
	spannerTableMembers = "team_memberships"
)
