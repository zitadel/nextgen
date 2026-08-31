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
	users  UserIdentityReader
	// platformProjectID is PlatformConfig.ProvisioningProjectID: the built-in
	// platform id when the deployment opted in via platform.bootstrap_project,
	// empty otherwise. Empty makes every call a no-op — a standalone
	// deployment that merely pins platform.project_id as its console default
	// must never mint teams for its end users (#605, #736).
	platformProjectID string
}

// NewPersonalTeamService wires the ensurer. `users` resolves the user's email
// for the team's display name.
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
		return fmt.Errorf("ensure personal team: resolve membership for %s: %w", userID, err)
	}

	unique := uniqueTeamName(userID)
	name := s.preferredTeamName(ctx, projectID, userID)
	if name == "" {
		name = unique
	}

	err := s.provision(ctx, projectID, userID, name)
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*database.UniqueError](err); !ok {
		return fmt.Errorf("ensure personal team: provision for %s: %w", userID, err)
	}

	// A unique violation is one of two different situations, and they are told
	// apart by whether this user ended up with a membership.
	//
	// (a) A concurrent ensure for THIS user won — registration racing the first
	//     sign-in. Both computed the same name, the winner committed team and
	//     membership together, so we are already provisioned: converge.
	if _, rerr := s.v2Pool.Statements().GetPersonalTeamForUser(ctx, projectID, userID); rerr == nil {
		return nil
	}
	// (b) The display name is simply taken by ANOTHER team in this project —
	//     team names are unique per project, and the email that seeds the
	//     friendly name is only unique by schema convention. The friendly name
	//     is a convenience, never the requirement: retry once with the id-based
	//     name, which cannot collide.
	if name == unique {
		return fmt.Errorf("ensure personal team: provision for %s: %w", userID, err)
	}
	if err := s.provision(ctx, projectID, userID, unique); err != nil {
		return fmt.Errorf("ensure personal team: provision for %s under a unique name: %w", userID, err)
	}
	return nil
}

// provision creates the team and the user's membership in one transaction, so
// a registered user never ends up with a team they are not a member of.
func (s *personalTeamService) provision(ctx context.Context, projectID, userID, name string) error {
	team, err := domain.NewTeam(projectID, name)
	if err != nil {
		return err
	}

	actorHuman := domain.EventActorTypeHuman
	return s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
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
}

// preferredTeamName is the friendly default: "max@example.com personal team",
// from the user's email. The shipped platform schema marks email
// `x-unique: "project"`, so this is collision-free in practice — but that is a
// *schema* property, not a guarantee of the teams table, which is why the
// caller keeps an id-based fallback for a schema that drops the marker or
// scopes it to a team.
//
// The name is a convenience only. It is not an identifier, it does not bind
// the team to its first member, and anyone can change it later via
// PATCH /teams/{id}; a team whose original member leaves keeps working under a
// name that no longer fits, which is a rename, not a defect.
func (s *personalTeamService) preferredTeamName(ctx context.Context, projectID, userID string) string {
	user, err := s.users.GetIdentity(ctx, projectID, userID, "email")
	if err != nil || user == nil {
		return ""
	}
	email := user.Email()
	if email == "" {
		return ""
	}
	name, err := domain.ValidateTeamName(email + " personal team")
	if err != nil {
		return ""
	}
	return name
}

// uniqueTeamName is the collision-free default. It is derived from the user id
// rather than any human attribute, so it is unique per project by construction
// and stays stable no matter who ends up in the team.
func uniqueTeamName(userID string) string {
	return "Personal " + userID
}
