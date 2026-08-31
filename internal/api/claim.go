package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/muhlemmer/gu"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) InitClaim(ctx context.Context, params api.InitClaimParams) (api.InitClaimRes, error) {
	projectID := string(params.ProjectID)
	// opWrite: init mints state and the contract scopes it to project.write.
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opWrite); err != nil {
		return nil, err
	}
	scopeCtx, _ := GetScopeContext(ctx)
	res, err := h.claimService.Init(ctx, projectID, scopeCtx.SecretHash)
	if err != nil {
		if resp, ok := alreadyClaimedResponse(err); ok {
			return resp, nil
		}
		return nil, err
	}
	claimURL, err := url.Parse(res.ClaimURL)
	if err != nil {
		// The claim URL derives from the configured console base; an unparsable
		// one is deployment misconfiguration, not a client error.
		return nil, domain.ErrInternal(err).WithMessage("invalid claim url")
	}
	return &api.InitClaimResponse{
		ClaimURL:    *claimURL,
		ChallengeID: api.ChallengeID(res.ChallengeID),
		ExpiresAt:   res.ExpiresAt,
	}, nil
}

func (h *Handler) GetClaimStatus(ctx context.Context, params api.GetClaimStatusParams) (api.GetClaimStatusRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	scopeCtx, _ := GetScopeContext(ctx)
	res, err := h.claimService.Status(ctx, projectID, string(params.ChallengeID), scopeCtx.SecretHash)
	if err != nil {
		return nil, err
	}
	if res.Status == domain.ClaimChallengeStatusCompleted {
		dashboardURL, err := url.Parse(res.DashboardURL)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("invalid dashboard url")
		}
		resp := api.NewClaimStatusCompletedClaimStatusResponse(api.ClaimStatusCompleted{
			Status:       api.ClaimStatusCompletedStatusCompleted,
			TeamID:       api.TeamID(res.TeamID),
			ClaimedAt:    res.ClaimedAt,
			DashboardURL: *dashboardURL,
		})
		return &resp, nil
	}
	resp := api.NewClaimStatusPendingClaimStatusResponse(api.ClaimStatusPending{
		Status: api.ClaimStatusPendingStatusPending,
	})
	return &resp, nil
}

func (h *Handler) CompleteClaim(ctx context.Context, req *api.CompleteClaimRequest, params api.CompleteClaimParams) (api.CompleteClaimRes, error) {
	userID, err := h.verifyClaimSession(ctx)
	if err != nil {
		return nil, err
	}
	res, err := h.claimService.Complete(ctx, string(params.ProjectID), string(req.ChallengeID), userID)
	if err != nil {
		if resp, ok := alreadyClaimedResponse(err); ok {
			return resp, nil
		}
		return nil, err
	}
	// The session actor is scoped to the platform project; rebind the request
	// to the claimed project so request.api lands next to the authz.granted
	// event (same pattern as CreateProject).
	audit.BindPublicRequest(ctx, res.ProjectID, "", "")
	return &api.CompleteClaimResponse{
		ProjectID: api.ProjectID(res.ProjectID),
		TeamID:    api.TeamID(res.TeamID),
		ClaimedAt: res.ClaimedAt,
	}, nil
}

// verifyClaimSession authenticates the human behind claim/complete (ADR 046 §2,
// Claim C2). It returns the session's user id. Every rejection is pre-wrapped
// as the public 401 verdict (auth.unauthorized) with the distinct sentinel kept
// in the parent chain for logs and tests. Production caller: CompleteClaim
// (Claim E1, #611).
func (h Handler) verifyClaimSession(ctx context.Context) (string, error) {
	sessionToken, ok := sessionTokenFromContext(ctx)
	if !ok {
		return "", invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}

	// The token already names its project, so a foreign-project session is
	// rejected before it is even loaded and its caller learns nothing about it.
	if h.platformProjectID == "" || sessionToken.ProjectID != h.platformProjectID {
		return "", invalidSessionCredential(domain.ErrClaimSessionWrongProject())
	}

	session, err := h.sessionService.Get(ctx, service.GetSessionInput{
		ProjectID: sessionToken.ProjectID,
		SessionID: gu.Value(sessionToken.SessionID),
	})
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			return "", invalidSessionCredential(err)
		}
		return "", err
	}

	if session.TokenID != sessionToken.TokenID {
		return "", invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}
	// Explicit expiry check before State(), which reports a factor-less expired
	// session as Building.
	if time.Now().After(session.ExpiresAt) {
		return "", invalidSessionCredential(domain.ErrClaimSessionExpired())
	}
	if session.State() != domain.SessionStateActive {
		return "", invalidSessionCredential(domain.ErrClaimSessionNotActive())
	}
	if session.UserID == nil || *session.UserID == "" {
		return "", invalidSessionCredential(domain.ErrClaimSessionNotActive())
	}
	return *session.UserID, nil
}

// ------------------ Errors ---------------

// alreadyClaimedResponse converts proj.already_claimed into the typed 409 body
// with flat details {team_id, dashboard_url}. Routing it through NewError
// instead would nest the producer details under details.details (ADR 030
// envelope), which the CLI (error.body.details.team_id) cannot read.
func alreadyClaimedResponse(err error) (*api.AlreadyClaimedResponse, bool) {
	de, ok := errors.AsType[domain.Error](err)
	if !ok || de.Code != domain.ErrProjectAlreadyClaimed().Code {
		return nil, false
	}
	details, ok := de.Details.(domain.ClaimConflictDetails)
	if !ok {
		return nil, false
	}
	dashboardURL, perr := url.Parse(details.DashboardURL)
	if perr != nil {
		// Fall back to the generic envelope rather than answering 500 for a
		// conflict the service already resolved.
		return nil, false
	}
	return &api.AlreadyClaimedResponse{
		Code:    de.Code,
		Message: de.Message,
		Details: api.AlreadyClaimedResponseDetails{
			TeamID:       api.TeamID(details.TeamID),
			DashboardURL: *dashboardURL,
		},
	}, true
}

// claimErrorResponse maps claim_challenge.* and claim.* codes. The proj.*
// claim errors (already_claimed, claim_expired, permission_denied) route
// through projectErrorResponse.
func claimErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrClaimChallengeNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrClaimChallengeInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrClaimNoPersonalTeam().Code:
		// The session is authenticated but the user is not eligible to receive
		// the project: no active personal team to attach it to. Reachable until
		// #527 auto-creates the personal team at registration.
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrPersonalTeamNotActive("").Code:
		// Same refusal, different cause: the membership exists but is not
		// active, so #527's auto-creation will not clear it. A distinct code so
		// the console can say that instead of implying the user needs to wait;
		// the membership status in the details says what would clear it.
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		// The claim.session_* sentinels only ever leave verifyClaimSession
		// wrapped in auth.unauthorized. Anything landing here unwrapped is an
		// internal invariant break.
		return internalErrorResponse(err)
	}
}
