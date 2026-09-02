package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-faster/jx"
	"github.com/muhlemmer/gu"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/ogenx"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/oidc/v3/pkg/op"
)

const (
	sessionCookieName = "__nextgen_session"
)

func (h Handler) CreateSession(ctx context.Context, req *api.CreateSessionRequest) (api.CreateSessionRes, error) {
	input := service.CreateSessionInput{
		ProjectID: string(req.ProjectID),
		UserAgent: userAgentToDomain(req.UserAgent),
	}

	session, err := h.sessionService.Create(ctx, input)
	if err != nil {
		return nil, err
	}

	tokenCrypter, err := h.keyService.GetProjectCrypter(ctx, string(req.ProjectID), domain.EncryptionKeyPurposeToken)
	if err != nil {
		return nil, err
	}

	return sessionWithTokenToAPI(ctx, session, tokenCrypter)
}

func (h Handler) ExchangeHandoff(ctx context.Context, req *api.ExchangeRequest, params api.ExchangeHandoffParams) (api.ExchangeHandoffRes, error) {
	input, err := exchangeInputFromRequest(req, params)
	if err != nil {
		return nil, err
	}
	session, err := h.sessionService.Exchange(ctx, input)
	if err != nil {
		return nil, err
	}

	// Platform personal-team ensure (#527). The exchange is the one
	// credential-agnostic point every account passes through before any
	// authenticated call: a fresh registration exchanges its handoff token
	// immediately, so the team is normally in place before the first claim, and
	// users provisioned before this effect existed converge on their next
	// sign-in (the backfill).
	//
	// Best-effort, and that is a trade rather than an oversight. A failure here
	// must not cost the login, because a provisioning hiccup taking down
	// sign-in is far worse than the alternative it buys: the handoff is already
	// spent, so the caller keeps a valid session that briefly has no team, and
	// an immediate claim/complete answers claim.no_personal_team until the next
	// exchange retries. That 403 is the honest floor, and it clears itself.
	// Making the team a transactional postcondition of exchange would close the
	// window but couple the auth path to a provisioning write; provisioning at
	// claim instead is ruled out by ADR 046 §1, which says the claim
	// transaction only writes the grant and never creates a team or membership.
	if h.personalTeams != nil && session.UserID != nil {
		if err := h.personalTeams.EnsurePersonalTeam(ctx, session.ProjectID, *session.UserID); err != nil {
			slog.WarnContext(ctx, "personal team ensure failed on session exchange",
				slog.String("project_id", session.ProjectID),
				slog.String("user_id", *session.UserID),
				slog.Any("error", err))
		}
	}

	tokenCrypter, err := h.keyService.GetProjectCrypter(ctx, string(params.ProjectID), domain.EncryptionKeyPurposeToken)
	if err != nil {
		return nil, err
	}

	return sessionWithTokenToAPI(ctx, session, tokenCrypter)
}

func exchangeInputFromRequest(req *api.ExchangeRequest, params api.ExchangeHandoffParams) (service.ExchangeInput, error) {
	input := service.ExchangeInput{
		ProjectID:    string(params.ProjectID),
		HandoffToken: req.HandoffToken,
	}
	if key, ok := params.IdempotencyKey.Get(); ok {
		input.IdempotencyKey = new(key)
	}
	if ttl, ok := req.TTL.Get(); ok {
		input.TTL = new(time.Duration(ttl))
	}
	return input, nil
}

func (h Handler) GetSession(ctx context.Context, params api.GetSessionParams) (api.GetSessionRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.SessionID), sessionAccess, opRead)
	if err != nil {
		return nil, err
	}
	input := service.GetSessionInput{
		ProjectID:        projectID,
		SessionID:        string(params.SessionID),
		WithUserIdentity: true,
	}

	session, err := h.sessionService.Get(ctx, input)
	if err != nil {
		return nil, err
	}
	return sessionToAPI(session), nil
}

func (h Handler) GetMySession(ctx context.Context) (api.GetMySessionRes, error) {
	sessionToken, ok := sessionTokenFromContext(ctx)
	if !ok {
		return nil, invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}
	input := service.GetSessionInput{
		ProjectID:        sessionToken.ProjectID,
		SessionID:        gu.Value(sessionToken.SessionID),
		WithUserIdentity: true,
	}

	session, err := h.sessionService.Get(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := validateSessionToken(session, sessionToken); err != nil {
		return nil, invalidSessionCredential(err)
	}
	return &api.SessionResponseHeaders{
		CacheControl: api.NewOptString(sessionStateCacheControl),
		Response:     *sessionToAPI(session),
	}, nil
}

func (h Handler) QuerySessions(ctx context.Context, req *api.QuerySessionsRequest, params api.QuerySessionsParams) (api.QuerySessionsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), sessionAccess, opRead); err != nil {
		return nil, err
	}
	listed, err := h.sessionService.List(ctx, mapQuerySessionsToService(string(params.ProjectID), req))
	if err != nil {
		return nil, err
	}
	resp := sessionsToAPI(listed.Sessions)
	if listed.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	return resp, nil
}

func mapQuerySessionsToService(projectID string, req *api.QuerySessionsRequest) service.ListSessionInput {
	input := service.ListSessionInput{
		ProjectID: projectID,
		Limit:     int(req.Limit.Or(0)), // if not defined, set to default value in the service layer
		PageToken: string(req.PageToken.Or("")),
	}
	if sorting, ok := req.Sorting.Get(); ok {
		input.Sorting = sortingToService(sorting.Field, sorting.Direction)
	}
	for _, filter := range req.Filter {
		input.Filters = append(input.Filters, filterToService(filter.Field, filter.Operation, filter.Value))
	}
	return input
}

func (h Handler) RevokeSession(ctx context.Context, params api.RevokeSessionParams) (api.RevokeSessionRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.SessionID), sessionAccess, opDelete)
	if err != nil {
		if errors.Is(err, errResourceGone) {
			return &api.RevokeSessionNoContent{}, nil
		}
		return nil, err
	}
	input := service.DeleteSessionInput{
		ProjectID: projectID,
		SessionID: string(params.SessionID),
	}

	err = h.sessionService.Delete(ctx, input)
	if err != nil {
		return nil, err
	}
	// No Set-Cookie: this operation revokes a session by id on behalf of an
	// operator, so the caller's own __nextgen_session cookie is unrelated to the
	// revoked session. Clearing it here signs the operator out. Cookie clearing
	// belongs to RevokeMySession, which acts on the cookie's own session.
	return &api.RevokeSessionNoContent{}, nil
}

func (h Handler) RevokeMySession(ctx context.Context) (api.RevokeMySessionRes, error) {
	sessionToken, ok := sessionTokenFromContext(ctx)
	if !ok {
		return nil, invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}
	input := service.DeleteSessionInput{
		ProjectID: sessionToken.ProjectID,
		SessionID: gu.Value(sessionToken.SessionID),
	}

	session, err := h.sessionService.Get(ctx, service.GetSessionInput{
		ProjectID: input.ProjectID,
		SessionID: input.SessionID,
	})
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			// The session is already gone; logout is idempotent. Clear the cookie
			// and return 204 rather than surfacing a 404 for an absent session.
			return &api.RevokeMySessionNoContent{SetCookie: deleteSessionCookie(ctx)}, nil
		}
		return nil, err
	}
	if err := validateSessionToken(session, sessionToken); err != nil {
		return nil, invalidSessionCredential(err)
	}

	err = h.sessionService.Delete(ctx, input)
	if err != nil {
		return nil, err
	}
	return &api.RevokeMySessionNoContent{
		SetCookie: deleteSessionCookie(ctx),
	}, nil
}

// invalidSessionCredential normalizes a cookie that decrypted successfully but
// no longer names the current live session token (expired or rotated) to the
// same public verdict as a missing or undecryptable cookie. Self-session
// endpoints must not expose token lifecycle details, and their OpenAPI 401
// contract promises auth.unauthorized rather than the internal
// sess.token_invalid diagnostic.
func invalidSessionCredential(err error) domain.Error {
	return domain.ErrAuthUnauthorized(err).WithMessage(sessionUnauthorizedMessage)
}

func validateSessionToken(session *domain.Session, token *domain.Token) error {
	if session.TokenID != token.TokenID {
		return domain.ErrSessionTokenInvalid()
	}
	if time.Now().After(session.ExpiresAt) {
		return domain.ErrSessionTokenInvalid()
	}
	return nil
}

func userAgentToDomain(agent api.OptCreateSessionRequestUserAgent) *domain.UserAgent {
	userAgent, ok := agent.Get()
	if !ok {
		return nil
	}
	info := make(map[string]any)
	for key, value := range userAgent.AdditionalProps {
		info[key] = value.String()
	}
	return &domain.UserAgent{
		ID:   userAgent.GetFingerprint().Value,
		IP:   userAgent.GetIP().Value,
		Info: info,
	}
}

func sessionWithTokenToAPI(ctx context.Context, session *domain.Session, encrypter op.Encrypter) (*api.SessionWithTokenResponseHeaders, error) {
	token, err := session.Token(encrypter)
	if err != nil {
		return nil, err
	}
	return &api.SessionWithTokenResponseHeaders{
		SetCookie: setSessionCookie(ctx, token, session.ExpiresAt),
		Response: api.SessionWithTokenResponse{
			Session:      *sessionToAPI(session),
			SessionToken: token,
		},
	}, nil
}

func sessionToAPI(session *domain.Session) *api.SessionResponse {
	factors := make([]api.CompletedFactor, len(session.Factors))
	for i, factor := range session.Factors {
		factors[i] = factorToAPI(factor)
	}
	resp := &api.SessionResponse{
		SessionID:       api.SessionID(session.ID),
		ProjectID:       api.ProjectID(session.ProjectID),
		State:           sessionStateToAPI(session.State()),
		Factors:         factors,
		AssuranceLevels: nil,                                 // TODO: ?!
		Metadata:        api.OptNilSessionResponseMetadata{}, // TODO: ?!
		UserAgent:       userAgentToAPI(session.UserAgent),
		CreatedAt:       session.CreatedAt,
		ExpiresAt:       session.ExpiresAt,
	}
	if session.UserID != nil {
		resp.UserID = api.NewOptNilUserID(api.UserID(*session.UserID))
	}
	if session.User != nil {
		resp.User = api.NewOptUserRef(userRefToAPI(*session.User))
	}
	return resp
}

func userAgentToAPI(agent *domain.UserAgent) api.OptNilSessionResponseUserAgent {
	if agent == nil {
		return api.OptNilSessionResponseUserAgent{}
	}
	info := make(map[string]jx.Raw)
	for key, value := range agent.Info {
		switch key {
		case "fingerprint", "ip":
			continue
		}
		raw, err := json.Marshal(value)
		if err != nil {
			raw = []byte("null")
		}
		info[key] = jx.Raw(raw)
	}
	return api.NewOptNilSessionResponseUserAgent(api.SessionResponseUserAgent{
		Fingerprint:     api.NewOptString(agent.ID),
		IP:              api.NewOptString(agent.IP),
		AdditionalProps: info,
	})
}

func sessionStateToAPI(state domain.SessionState) api.SessionResponseState {
	switch state {
	case domain.SessionStateActive:
		return api.SessionResponseStateActive
	case domain.SessionStateExpired:
		return api.SessionResponseStateExpired
	default:
		// Building, and the zero value: no verified factor yet.
		return api.SessionResponseStateBuilding
	}
}

func sessionsToAPI(sessions []*domain.Session) *api.QuerySessionsResponse {
	response := &api.QuerySessionsResponse{
		Sessions: make([]api.SessionResponse, len(sessions)),
	}
	for i, session := range sessions {
		response.Sessions[i] = *sessionToAPI(session)
	}
	return response
}

func setSessionCookie(ctx context.Context, token string, expiresAt time.Time) string {
	maxAge := max(int(time.Until(expiresAt).Seconds()), 0)
	return sessionCookie(ctx, token, maxAge)
}

func deleteSessionCookie(ctx context.Context) string {
	return sessionCookie(ctx, "", 0)
}

func sessionCookie(ctx context.Context, token string, maxAge int) string {
	c := &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		HttpOnly: true,
		// Secure follows the request scheme so Safari can keep the cookie on
		// http://localhost (see cookieSecureFromContext).
		Secure:   cookieSecureFromContext(ctx),
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	}
	// http.Cookie treats MaxAge=0 as "omit Max-Age"; we always emit an
	// explicit max-age, and map non-positive values to delete (Max-Age=0).
	if maxAge <= 0 {
		c.MaxAge = -1
	} else {
		c.MaxAge = maxAge
	}
	return c.String()
}

func sessionErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrSessionNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrSessionTokenCreationFailed().Code:
		return errorResponseWithStatusCode(http.StatusInternalServerError, err)
	case domain.ErrSessionExchangeConflict().Code,
		domain.ErrSessionInvalidHandoffToken().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrSessionTokenInvalid().Code:
		return errorResponseWithStatusCode(http.StatusUnauthorized, err)
	case domain.ErrSessionPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrNotImplemented().Code:
		return errorResponseWithStatusCode(http.StatusNotImplemented, err)
	case domain.ErrSessionInvalidTTL().Code:
		apiErr := &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusBadRequest,
		}

		details, ok := err.Details.(domain.SessionInvalidTTLDetails)
		if !ok {
			apiErr.Response = domainErrorDetails(err)
			return apiErr
		}

		encoder := jx.GetEncoder()
		defer jx.PutEncoder(encoder)

		encoder.ObjStart()
		encoder.Field("ttl", ogenx.ISODuration(details.TTL).Encode)
		encoder.Field("max_ttl", ogenx.ISODuration(details.MaxTTL).Encode)
		encoder.ObjEnd()

		apiErr.Response = api.ErrorDetails{
			Code:    api.ErrorCode(err.Code),
			Message: err.Message,
			Details: api.OptErrorDetailsDetails{
				Set: true,
				Value: api.ErrorDetailsDetails{
					"details": jx.Raw(encoder.Bytes()),
				},
			},
		}
		return apiErr
	default:
		return internalErrorResponse(err)

	}
}
