package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// PersonalTeamEnsurer guarantees a platform-project user a team — the team
// `claim/complete` attaches claimed projects to (ADR 046 §2, #527).
//
// The requirement is only that a registered user *has* a team. The team is an
// ordinary team: it may later be renamed, shared, or end up carrying other
// members, and that is fine. "Personal team" is not a modeled concept — it
// resolves to the user's earliest active membership
// (`personalTeamForUserStmt`, shared with the claim service) — so a user who
// already holds any membership is already provisioned and the call is a no-op.
//
// An idempotent *ensure* rather than a create: it runs on session exchange —
// the one credential-agnostic point every registration and every sign-in
// passes through before any authenticated call — best-effort, so users created
// before the effect existed converge on their next sign-in too.
type PersonalTeamEnsurer interface {
	// EnsurePersonalTeam is a no-op outside the platform project and for users
	// that already hold an active membership. Otherwise it creates the team
	// and its membership in one transaction.
	EnsurePersonalTeam(ctx context.Context, projectID, userID string) error
}

type personalTeamService struct {
	v2Pool StatementPool
	// platformProjectID is PlatformConfig.ProvisioningProjectID: the built-in
	// platform id when the deployment opted in via platform.bootstrap_project,
	// empty otherwise. Empty makes every call a no-op — a standalone
	// deployment that merely pins platform.project_id as its console default
	// must never mint teams for its end users (#605, #736).
	platformProjectID string
}

// NewPersonalTeamService wires the ensurer.
func NewPersonalTeamService(
	v2Pool StatementPool,
	platformProjectID string,
) PersonalTeamEnsurer {
	return &personalTeamService{
		v2Pool:            v2Pool,
		platformProjectID: platformProjectID,
	}
}

func (s *personalTeamService) EnsurePersonalTeam(ctx context.Context, projectID, userID string) error {
	// Teams-on-registration is a platform-plane concept: every registration in
	// every customer project passes through the same funnel, and none of those
	// may mint teams. A silent no-op, not an error — off-platform callers are
	// the normal case.
	if s.platformProjectID == "" || projectID != s.platformProjectID {
		return nil
	}

	// Idempotency: any earliest active membership is the team this would
	// create, by the same resolution the claim service uses.
	if _, err := s.v2Pool.Statements().GetPersonalTeamForUser(ctx, projectID, userID); err == nil {
		return nil
	} else if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return domain.ErrInternal(err).WithMessage(fmt.Sprintf("failed fetching personal team for user %s", userID))
	}

	team, err := domain.NewTeam(projectID, personalTeamName(userID))
	if err != nil {
		return err
	}

	actorHuman := domain.EventActorTypeHuman
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		// CreateTeam mints the team id; CreateTeamMembership maintains the
		// authz membership edge itself, so the pair is complete provisioning.
		if err := tx.Statements().CreateTeam(ctx, team); err != nil {
			return err
		}
		if err := audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeTeamCreated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  team.ProjectID,
			EntityType: "team",
			EntityID:   team.ID,
			ActorID:    &userID,
			ActorType:  &actorHuman,
			Payload:    domain.TeamPayload{Name: team.Name},
		}); err != nil {
			return err
		}
		return tx.Statements().CreateTeamMembership(ctx, &domain.TeamMembership{
			ProjectID: projectID,
			TeamID:    team.ID,
			UserID:    userID,
			Status:    domain.MembershipStatusActive,
		})
	})

	if err != nil {
		// The name is deterministic per user, so a unique-name violation means
		// a concurrent ensure for THIS user already took the name — registration
		// racing the first sign-in. If that winner has committed, it committed
		// team AND membership together and we are already provisioned: converge.
		// Confirm rather than assume.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			if _, rerr := s.v2Pool.Statements().GetPersonalTeamForUser(ctx, projectID, userID); rerr == nil {
				return nil
			}
		}
		// Either the winner had not committed yet, or the name is held by an
		// unrelated team. Both call sites are best-effort and only log, so this
		// reports rather than retries: retrying under a different name is what
		// would produce the second team. The next sign-in ensures again, and by
		// then the winner has committed.
		return domain.ErrInternal(err).WithMessage(fmt.Sprintf("failed creating team for user %s", userID))
	}

	return nil
}

// personalTeamName derives the team's name from the user id alone. This is what
// limits a user to one team: team names are unique per project, so a name that
// is a pure function of the user id is the closest thing the schema has to a
// one-team-per-user constraint, and the database enforces it. Two ensures
// racing therefore compute the same name and one loses the insert, instead of
// both succeeding under different names and minting two teams.
//
// Deriving it from the user id rather than a human attribute is what keeps it
// safe to fail closed on: it is bounded well under TeamNameMaxLength and
// unguessable, so unlike an email-derived name it cannot be made invalid by a
// long address or squatted by an unrelated team.
//
// The name is a placeholder, not an identifier. It is renameable via
// PATCH /teams/{id}, and renaming is safe because later ensures short-circuit
// on the membership and never recompute it.
func personalTeamName(userID string) string {
	return "Personal " + userID
}
