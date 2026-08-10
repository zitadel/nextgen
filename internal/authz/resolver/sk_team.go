package resolver

import "strings"

// skTeamAllowed is the locked MAY list from docs/design/api/credentials.md.
// Keys are flat "{resource}.{verb}" permission names.
var skTeamAllowed = map[string]struct{}{
	"team.read":             {},
	"user.read":             {},
	"user.write":            {},
	"team_membership.read":  {},
	"team_membership.write": {},
	"event.read":            {},
}

// skTeamPermissionAllowed reports whether an sk_team_ credential may attempt
// the named permission. Unknown names are denied (fail closed).
func skTeamPermissionAllowed(permission string) bool {
	_, ok := skTeamAllowed[permission]
	return ok
}

// PermissionName builds the flat permission string used by the sk_team_ gate.
func PermissionName(objectType, relation string) string {
	return strings.TrimSpace(objectType) + "." + strings.TrimSpace(relation)
}
