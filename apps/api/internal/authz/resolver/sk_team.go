package resolver

// skTeamAllowed is the locked MAY list from docs/design/api/credentials.md.
var skTeamAllowed = map[string]struct{}{
	"team.read":             {},
	"user.read":             {},
	"user.write":            {},
	"team_membership.read":  {},
	"team_membership.write": {},
	"event.read":            {},
}

func skTeamPermissionAllowed(permission string) bool {
	_, ok := skTeamAllowed[permission]
	return ok
}

// PermissionName builds the flat "{resource}.{verb}" string for the sk_team_ gate.
func PermissionName(objectType, relation string) string {
	return objectType + "." + relation
}
