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
	teamID, err := claimedTeamID(ctx, s.v2Pool.Statements(), projectID)
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
	if err := s.v2Pool.Statements().CreateChallenge(ctx, challenge); err != nil {
		return nil, domain.ErrInternal(mapStorageError(err)).WithMessage("failed to create claim challenge")
	}
	return &ClaimInitResult{
		ClaimURL:    s.claimURL(projectID, plain),
		ChallengeID: plain,
		ExpiresAt:   challenge.ExpiresAt,
	}, nil
}

func (s *claimService) Status(ctx context.Context, projectID, challengeID, secretHash string) (*ClaimStatusResult, error) {
	challenge, err := s.v2Pool.Statements().GetChallengeByID(ctx, projectID, domain.HashClaimChallengeToken(challengeID))
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
		return s.completedStatus(ctx, projectID)
	}
	if time.Now().After(challenge.ExpiresAt) {
		return nil, domain.ErrProjectClaimExpired()
	}
	return &ClaimStatusResult{Status: domain.ClaimChallengeStatusPending}, nil
}

// completedStatus reconstructs team and claim time from the grant written at
// complete. Missing scope or grant on a completed challenge is corrupt state:
// both are written in the same transaction that marks completion.
func (s *claimService) completedStatus(ctx context.Context, projectID string) (*ClaimStatusResult, error) {
	stmts := s.v2Pool.Statements()
	scope, err := stmts.GetResourceScope(ctx, projectID)
	if err != nil || scope.TeamID == nil || *scope.TeamID == "" {
		return nil, domain.ErrInternal(err).WithMessage("completed claim challenge without a project-team scope")
	}
	assignments, err := stmts.ListAuthzAssignments(ctx, projectID, domain.AuthzPrincipalTypeTeam, *scope.TeamID, false)
	if err != nil {
		return nil, domain.ErrInternal(mapStorageError(err)).WithMessage("failed to load claim grant")
	}
	for _, a := range assignments {
		if a.ObjectType == "project" && a.Relation == "team" {
			return &ClaimStatusResult{
				Status:       domain.ClaimChallengeStatusCompleted,
				TeamID:       *scope.TeamID,
				ClaimedAt:    a.CreatedAt,
				DashboardURL: s.dashboardURL(projectID),
			}, nil
		}
	}
	return nil, domain.ErrInternal(nil).WithMessage("completed claim challenge without a project-team grant")
}

func (s *claimService) Complete(ctx context.Context, projectID, challengeID, userID string) (*ClaimCompleteResult, error) {
	challengeIDHash := domain.HashClaimChallengeToken(challengeID)
	var result *ClaimCompleteResult
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
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
		// Two different pending challenges racing on one project can still
		// double-write the grant under read committed: this check is app-level
		// and UpsertResourceScope overwrites team_id. Accepted for alpha; the
		// upgrade path is a conditional update (team_id IS NULL) or a partial
		// unique index on the grant.
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
				return domain.ErrClaimNoPersonalTeam()
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
		scope := domain.NewProjectResourceScope(projectID)
		scope.TeamID = &team.ID
		if err := stmts.UpsertResourceScope(ctx, scope); err != nil {
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
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to complete claim")
	}
	return result, nil
}

// claimedTeamID resolves the claim state all three legs branch on: a missing
// project is ErrProjectNotFound, an unclaimed project (no scope row or no
// team) is (nil, nil), a claimed project returns its owning team id.
// projectIsClaimed (event_claim.go) is deliberately not reused: events
// visibility treats a missing project as unclaimed, while claim needs the 404
// and the team id for the 409 details.
func claimedTeamID(ctx context.Context, stmts interface {
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	GetResourceScope(ctx context.Context, resourceID string) (*domain.ResourceScope, error)
}, projectID string) (*string, error) {
	if _, err := stmts.GetProjectByID(ctx, projectID); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to load project for claim")
	}
	scope, err := stmts.GetResourceScope(ctx, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to load project scope for claim")
	}
	if scope.TeamID == nil || *scope.TeamID == "" {
		return nil, nil
	}
	return scope.TeamID, nil
}

func (s *claimService) alreadyClaimedErr(projectID, teamID string) error {
	return domain.ErrProjectAlreadyClaimed().WithDetails(domain.ClaimConflictDetails{
		TeamID:       teamID,
		DashboardURL: s.dashboardURL(projectID),
	})
}

func (s *claimService) claimURL(projectID, token string) string {
	query := url.Values{"challenge_id": {token}, "project_id": {projectID}}
	return s.consoleBaseURL + "/claim?" + query.Encode()
}

func (s *claimService) dashboardURL(projectID string) string {
	return s.consoleBaseURL + "/projects/" + projectID
}
