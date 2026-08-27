package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// PersonalTeamEnsurer guarantees a platform-project user their personal team —
// the team `claim/complete` attaches claimed projects to (ADR 046 §2, #527).
//
// An idempotent *ensure* rather than a create: it is invoked from more than
// one place (after flow registration, and as a self-heal on session exchange),
// the call sites are best-effort, and users provisioned before the effect
// existed must converge too. "Personal team" is defined as the user's earliest
// active membership (`personalTeamForUserStmt`, shared with the claim
// service), so a user who already has any membership — seeded, migrated, or a
// previous ensure — is already provisioned and the call is a no-op.
type PersonalTeamEnsurer interface {
	// EnsurePersonalTeam is a no-op outside the platform project and for users
	// that already hold an active membership. Otherwise it creates the
	// personal team and its membership in one transaction.
	EnsurePersonalTeam(ctx context.Context, projectID, userID string) error
}

type personalTeamService struct {
	v2Pool StatementPool
	users  UserIdentityReader
	// platformProjectID is PlatformConfig.ProvisioningProjectID: the built-in
	// platform id when the deployment opted in via platform.bootstrap_project,
	// empty otherwise. Empty makes every call a no-op — a standalone
	// deployment that merely pins platform.project_id as its console default
	// must never mint personal teams for its end users (#605, #736).
	platformProjectID string
}

// NewPersonalTeamService wires the ensurer. `users` resolves the registration
// identifier (email) for the team's display name.
func NewPersonalTeamService(
	v2Pool StatementPool,
	users UserIdentityReader,
	platformProjectID string,
) PersonalTeamEnsurer {
	return &personalTeamService{
		v2Pool:            v2Pool,
		users:             users,
		platformProjectID: platformProjectID,
	}
}

func (s *personalTeamService) EnsurePersonalTeam(ctx context.Context, projectID, userID string) error {
	// Personal teams are a platform-plane concept: every registration in every
	// customer project passes through the same funnel, and none of those may
	// mint teams. A silent no-op, not an error — off-platform callers are the
	// normal case.
	if s.platformProjectID == "" || projectID != s.platformProjectID {
		return nil
	}

	// Idempotency: any earliest active membership IS the personal team, by the
	// same resolution the claim service uses.
	if _, err := s.v2Pool.Statements().GetPersonalTeamForUser(ctx, projectID, userID); err == nil {
		return nil
	} else if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return fmt.Errorf("ensure personal team: resolve membership for %s: %w", userID, err)
	}

	team, err := domain.NewTeam(projectID, s.personalTeamName(ctx, projectID, userID))
	if err != nil {
		return fmt.Errorf("ensure personal team: %w", err)
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
		// The team name is deterministic per user, so a unique-name violation
		// is the lost half of a concurrent ensure (registration racing the
		// first sign-in): the winner's transaction committed team AND
		// membership together. Confirm rather than assume.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			if _, rerr := s.v2Pool.Statements().GetPersonalTeamForUser(ctx, projectID, userID); rerr == nil {
				return nil
			}
		}
		return fmt.Errorf("ensure personal team: provision for %s: %w", userID, err)
	}
	return nil
}

// personalTeamName derives the team's display name from the user's email —
// user-facing (team lists, the claim 409's owning-team details) and unique per
// project alongside the identifier itself. Determinism is load-bearing: it is
// what turns a concurrent double-ensure into a unique-name conflict instead of
// two teams. A user whose email cannot be read falls back to a name derived
// from the user id — equally deterministic and collision-free.
func (s *personalTeamService) personalTeamName(ctx context.Context, projectID, userID string) string {
	user, err := s.users.GetIdentity(ctx, projectID, userID, "email")
	if err == nil {
		if email := user.Email(); email != "" {
			return email
		}
	}
	return "Personal " + userID
}
