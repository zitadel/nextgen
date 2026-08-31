package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/url"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ClaimService is the claim use-case surface (ADR 046): the server side of the
// init/poll/complete dance that attaches an unclaimed project to the claiming
// user's personal team. Handler wiring is Claim E2 (#612).
type ClaimService interface {
	// Init mints a single-use challenge for an unclaimed project. secretHash
	// is the hex SHA-256 of the presented project-secret bearer, computed by
	// the handler; it is stored so Status can verify proof of possession.
	Init(ctx context.Context, projectID, secretHash string) (*ClaimInitResult, error)
	// Status reports the challenge state. challengeID is the plaintext token
	// from Init; secretHash must match the initiating secret's hash.
	Status(ctx context.Context, projectID, challengeID, secretHash string) (*ClaimStatusResult, error)
	// Complete spends the challenge and attaches the project to userID's
	// personal team in one transaction. userID comes from the platform-session
	// check (verifyClaimSession, C2).
	Complete(ctx context.Context, projectID, challengeID, userID string) (*ClaimCompleteResult, error)
}

type ClaimInitResult struct {
	// ClaimURL is the browser URL the developer opens; it embeds the plaintext
	// challenge token so the browser leg never needs the project secret.
	ClaimURL string
	// ChallengeID is the plaintext challenge token the CLI polls with.
	ChallengeID string
	ExpiresAt   time.Time
}

type ClaimStatusResult struct {
	Status domain.ClaimChallengeStatus
	// TeamID, ClaimedAt, and DashboardURL are set only when Status is
	// completed, reconstructed from the grant (claim state lives in the
	// permission engine, ADR 046 §1).
	TeamID       string
	ClaimedAt    time.Time
	DashboardURL string
}

type ClaimCompleteResult struct {
	ProjectID string
	TeamID    string
	ClaimedAt time.Time
}

type claimService struct {
	v2Pool *DB
	// consoleBaseURL is origin plus console path without a trailing slash,
	// e.g. "https://host/ui/console"; claim and dashboard URLs hang off it.
	consoleBaseURL    string
	platformProjectID string
}

var _ ClaimService = (*claimService)(nil)

// Caller-side statement dependencies: the exact slice of AllStatements the
// claim flow touches, so the future per-resource Statements split has its
// seam ready. The pool-level half (ClaimPool, Statementer[ClaimStatements])
// waits on go 1.27 generic methods; see the commented block in database.go.

// claimedProjectStatements is what the claimed-check reads (Init, Complete).
// The active owning-team grant is the claim source of truth (ADR 046 / 054 §2).
type claimedProjectStatements interface {
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	GetActiveOwningTeamGrant(ctx context.Context, projectID string) (*domain.AuthzAssignment, error)
}

// claimStatements is the claim service's full statement surface.
type claimStatements interface {
	claimedProjectStatements
	CreateChallenge(ctx context.Context, entity *domain.ClaimChallenge) error
	GetChallengeByID(ctx context.Context, projectID, id string) (*domain.ClaimChallenge, error)
	MarkChallengeCompleted(ctx context.Context, projectID, id string) error
	GetPersonalTeamForUser(ctx context.Context, projectID, userID string) (*domain.Team, error)
	GetEarliestTeamMembership(ctx context.Context, projectID, userID string) (*domain.TeamMembership, error)
	CreateAuthzAssignment(ctx context.Context, assignment *domain.AuthzAssignment) error
	InsertEvent(ctx context.Context, event *domain.Event) error
}

// noPersonalTeamErr splits the resolver's single not-found into the two states
// behind it. GetPersonalTeamForUser collapses them because the claim is refused
// either way, but a caller has to tell them apart: "you hold no membership at
// all" resolves itself, since the next sign-in provisions one (#527), while a
// membership that exists but is not active will not be provisioned around.
//
// What clears the second depends on the status, which is why it travels with
// the error rather than being summarised in it: `removed` follows a team or
// user deactivation and needs someone to restore the user's access (a user
// deactivation cascades without touching their teams, so the team itself may
// still be active), while `pending` is an invitation the user can still accept.
//
// This refines a verdict already reached; it does not revisit it. The two reads
// take separate snapshots under read-committed, so provisioning or a
// reactivation committing in between can show an *active* membership here even
// though the resolver just refused the claim. Reporting "not active: active"
// would be self-contradictory, so an active membership falls back to the
// original verdict: the refusal is then transient and the next attempt sees the
// team. (The same fallback covers an active membership on a deactivated team,
// which DeactivateTeam's cascade to removed should already prevent.)
func (s *claimService) noPersonalTeamErr(ctx context.Context, stmts claimStatements, userID string) error {
	membership, err := stmts.GetEarliestTeamMembership(ctx, s.platformProjectID, userID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrClaimNoPersonalTeam()
		}
		return err
	}
	if membership.Status == domain.MembershipStatusActive {
		return domain.ErrClaimNoPersonalTeam()
	}
	return domain.ErrPersonalTeamNotActive(membership.Status.String())
}

// NewClaimService builds the claim service. platformProjectID is the project
// hosting the claiming humans' accounts and personal teams (ADR 046 §2).
func NewClaimService(v2Pool *DB, consoleBaseURL, platformProjectID string) ClaimService {
	return &claimService{
		v2Pool:            v2Pool,
		consoleBaseURL:    consoleBaseURL,
		platformProjectID: platformProjectID,
	}
}

func (s *claimService) Init(ctx context.Context, projectID, secretHash string) (*ClaimInitResult, error) {
	var stmts claimStatements = s.v2Pool.Statements()
	teamID, err := claimedTeamID(ctx, stmts, projectID)
	if err != nil {
		return nil, err
	}
	if teamID != nil {
		return nil, s.alreadyClaimedErr(projectID, *teamID)
	}

	plain, id, err := domain.NewClaimChallengeToken()
	if err != nil {
		return nil, err
	}
	challenge, err := domain.NewClaimChallenge(id, projectID, secretHash, time.Now().Add(domain.ClaimChallengeTTL))
	if err != nil {
		return nil, err
	}
	if err := stmts.CreateChallenge(ctx, challenge); err != nil {
		return nil, domain.ErrInternal(mapStorageError(err)).WithMessage("failed to create claim challenge")
	}
	return &ClaimInitResult{
		ClaimURL: s.consoleBaseURL +
			"/claim?" +
			url.Values{"challenge_id": {plain}, "project_id": {projectID}}.Encode(),
		ChallengeID: plain,
		ExpiresAt:   challenge.ExpiresAt,
	}, nil
}

func (s *claimService) Status(ctx context.Context, projectID, challengeID, secretHash string) (*ClaimStatusResult, error) {
	var stmts claimStatements = s.v2Pool.Statements()
	challenge, err := stmts.GetChallengeByID(ctx, projectID, domain.HashClaimChallengeToken(challengeID))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrClaimChallengeNotFound()
		}
		return nil, domain.ErrInternal(mapStorageError(err)).WithMessage("failed to load claim challenge")
	}
	// Proof of possession before anything else: a caller without the
	// initiating secret learns nothing about the challenge, not even expiry.
	// Constant-time comparison as defense in depth; both sides are SHA-256
	// hex digests, so equal length is the normal case.
	if subtle.ConstantTimeCompare([]byte(challenge.InitiatingSecretHash), []byte(secretHash)) == 0 {
		return nil, domain.ErrProjectPermissionDenied()
	}
	if challenge.Status == domain.ClaimChallengeStatusCompleted {
		return s.completedStatus(ctx, stmts, projectID)
	}
	if time.Now().After(challenge.ExpiresAt) {
		return nil, domain.ErrProjectClaimExpired()
	}
	return &ClaimStatusResult{Status: domain.ClaimChallengeStatusPending}, nil
}

// completedStatus reconstructs team and claim time from the grant written at
// complete. A missing grant on a completed challenge is corrupt state: it is
// written in the same transaction that marks completion.
func (s *claimService) completedStatus(ctx context.Context, stmts claimStatements, projectID string) (*ClaimStatusResult, error) {
	grant, err := stmts.GetActiveOwningTeamGrant(ctx, projectID)
	if err != nil {
		return nil, domain.ErrInternal(mapStorageError(err)).WithMessage("completed claim challenge without a project-team grant")
	}
	return &ClaimStatusResult{
		Status:       domain.ClaimChallengeStatusCompleted,
		TeamID:       grant.PrincipalID,
		ClaimedAt:    grant.CreatedAt,
		DashboardURL: s.dashboardURL(projectID),
	}, nil
}

func (s *claimService) Complete(ctx context.Context, projectID, challengeID, userID string) (*ClaimCompleteResult, error) {
	challengeIDHash := domain.HashClaimChallengeToken(challengeID)
	var result *ClaimCompleteResult
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var stmts claimStatements = tx.Statements()
		challenge, err := stmts.GetChallengeByID(ctx, projectID, challengeIDHash)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrClaimChallengeNotFound()
			}
			return err
		}
		if challenge.Status == domain.ClaimChallengeStatusPending && time.Now().After(challenge.ExpiresAt) {
			return domain.ErrProjectClaimExpired()
		}
		// The claimed-check also answers a re-spent completed challenge:
		// completion wrote the grant in this same transaction shape, so a
		// completed challenge always reports 409 with the owning team rather
		// than 410 (matching the OpenAPI contract and the api-mock).
		//
		// Two different pending challenges racing on one project cannot
		// double-write the grant: authz_assignments_one_owning_team keeps at
		// most one active owning-team row per project (ADR 054 §2), so the
		// losing insert conflicts and Complete's caller-side handler below
		// turns it into the same 409.
		teamID, err := claimedTeamID(ctx, stmts, projectID)
		if err != nil {
			return err
		}
		if teamID != nil {
			return s.alreadyClaimedErr(projectID, *teamID)
		}
		team, err := stmts.GetPersonalTeamForUser(ctx, s.platformProjectID, userID)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return s.noPersonalTeamErr(ctx, stmts, userID)
			}
			return err
		}
		// Single-use guard: the pending→completed UPDATE serializes concurrent
		// completes of the same challenge; the loser sees no row and gets 410.
		if err := stmts.MarkChallengeCompleted(ctx, projectID, challengeIDHash); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrProjectClaimExpired()
			}
			return err
		}
		asgn := domain.NewClaimTeamAssignment(projectID, team.ID)
		if err := stmts.CreateAuthzAssignment(ctx, asgn); err != nil {
			return err
		}
		// claimed_by_user_id provenance (ADR 046 §1) lives on the audit event:
		// the grantor columns are reserved for delegations by a schema CHECK.
		actorType := domain.EventActorTypeHuman
		if err := audit.Emit(ctx, stmts, audit.EmitSpec{
			Type:       domain.EventTypeAuthzGranted,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  asgn.ProjectID,
			EntityType: "authz_assignment",
			EntityID:   asgn.ID,
			ActorID:    &userID,
			ActorType:  &actorType,
			Payload: domain.AuthzGrantedPayload{
				PrincipalType: asgn.PrincipalType.String(),
				PrincipalID:   asgn.PrincipalID,
				Relation:      asgn.Relation,
			},
		}); err != nil {
			return err
		}
		result = &ClaimCompleteResult{ProjectID: projectID, TeamID: team.ID, ClaimedAt: asgn.CreatedAt}
		return nil
	})
	if err != nil {
		err = mapStorageError(err)
		// A unique violation out of this transaction is the lost cross-challenge
		// claim race (authz_assignments_one_owning_team): the winner's grant
		// committed first. Re-read it for the 409's owning-team details.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			if teamID, terr := claimedTeamID(ctx, s.v2Pool.Statements(), projectID); terr == nil && teamID != nil {
				return nil, s.alreadyClaimedErr(projectID, *teamID)
			}
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to complete claim")
	}
	return result, nil
}

// claimedTeamID resolves the claim state all three legs branch on: a missing
// project is ErrProjectNotFound, an unclaimed project (no active owning-team
// grant) is (nil, nil), a claimed project returns its owning team id.
// projectIsClaimed (event_claim.go) is deliberately not reused: events
// visibility treats a missing project as unclaimed, while claim needs the 404
// and the team id for the 409 details.
func claimedTeamID(ctx context.Context, stmts claimedProjectStatements, projectID string) (*string, error) {
	if _, err := stmts.GetProjectByID(ctx, projectID); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to load project for claim")
	}
	grant, err := stmts.GetActiveOwningTeamGrant(ctx, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to load claim grant for project")
	}
	return &grant.PrincipalID, nil
}

func (s *claimService) alreadyClaimedErr(projectID, teamID string) error {
	return domain.ErrProjectAlreadyClaimed().WithDetails(domain.ClaimConflictDetails{
		TeamID:       teamID,
		DashboardURL: s.dashboardURL(projectID),
	})
}

func (s *claimService) dashboardURL(projectID string) string {
	return s.consoleBaseURL + "/projects/" + projectID
}
