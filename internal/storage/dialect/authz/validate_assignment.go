package authz

import (
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
)

// ErrSKTeamProjectScope is returned when an sk_team_ grant for a team-bound
// permission is minted with project scope.
var ErrSKTeamProjectScope = errors.New("authz: sk_team grants for team-bound permissions must be team-scoped")

// ValidateAssignment rejects sk_team_ + project-scope grants for team-bound
// object types (user, team, team_membership, event). Call from every dialect's
// CreateAuthzAssignment before INSERT.
func ValidateAssignment(a *domain.AuthzAssignment) error {
	if a == nil {
		return nil
	}
	if a.PrincipalType != domain.AuthzPrincipalTypeSKTeam {
		return nil
	}
	if !domain.TeamBoundObjectType(a.ObjectType) {
		return nil
	}
	if a.ScopeKind == domain.AuthzScopeKindProject {
		return ErrSKTeamProjectScope
	}
	if a.ScopeKind == domain.AuthzScopeKindTeam && (a.ScopeTeamID == nil || *a.ScopeTeamID == "") {
		return ErrSKTeamProjectScope
	}
	return nil
}
