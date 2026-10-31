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
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/oidc/v3/pkg/op"
)

const (
	// sessionCookieName is the session cookie's canonical name, the one the
	// sessionCookie security scheme names (ADR 083). The `__Host-` prefix makes
	// a browser refuse it from anywhere but this host over a secure response,
	// so no sibling host can plant a session cookie the server reads.
	sessionCookieName = "__Host-zitadel_session"
	// loopbackSessionCookieName is the name over plain http to a loopback host,
	// where the cookie has no Secure for Safari (see cookieSecureFromContext),
	// and so cannot carry the prefix.
	loopbackSessionCookieName = "zitadel_session"
)

// sessionCookieNameFor is the name a session cookie is set under, by whether
// it is Secure, as ssoBindingCookieName decides the SSO binding's.
func sessionCookieNameFor(secure bool) string {
	if secure {
		return sessionCookieName
	}
	return loopbackSessionCookieName
}

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
	scopeCtx, ok := GetScopeContext(ctx)
	if !ok {
		return nil, domain.ErrAuthUnauthorized(nil)
	}
	if queryProjectID := string(params.ProjectID); queryProjectID != "" && queryProjectID != scopeCtx.ProjectID {
		return nil, domain.ErrProjectMismatch()
	}

	input, err := exchangeInputFromRequest(req, params)
	if err != nil {
		return nil, err
	}
	input.ProjectID = scopeCtx.ProjectID
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
			zlog.Warn(ctx, "personal team ensure failed on session exchange",
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

// holdSessionToProject holds the cookie's session to the project the caller
// names in project_id, on the operations that act on that session or its user
// (/sessions/me, /users/me): a session of any other project is refused with
// sess.project_mismatch. Callers run it before they look anything up, so the
// refusal does not depend on the session's state: a live session of another
// project on the same server is not one of the caller's users. The refusal
// carries no Set-Cookie, so that session keeps its cookie.
func holdSessionToProject(token *domain.Token, projectID api.OptProjectID) error {
	if want, ok := projectID.Get(); ok && token.ProjectID != string(want) {
		return domain.ErrSessionProjectMismatch()
	}
	return nil
}

// mySession reads the session the request's cookie names and checks that the
// cookie is still its current token. A missing cookie and a superseded or
// expired token come back as the auth.unauthorized verdict; the session
// service's own errors, sess.not_found included, come back as they are, for
// each caller to answer in its own way. With projectID, a session of another
// project is refused before it is looked up (holdSessionToProject).
func (h Handler) mySession(ctx context.Context, projectID api.OptProjectID, withUserIdentity bool) (*domain.Session, error) {
	sessionToken, ok := sessionTokenFromContext(ctx)
	if !ok {
		return nil, invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}
	if err := holdSessionToProject(sessionToken, projectID); err != nil {
		return nil, err
	}
	session, err := h.sessionService.Get(ctx, service.GetSessionInput{
		ProjectID:        sessionToken.ProjectID,
		SessionID:        gu.Value(sessionToken.SessionID),
		WithUserIdentity: withUserIdentity,
	})
	if err != nil {
		return nil, err
	}
	if err := validateSessionToken(session, sessionToken); err != nil {
		return nil, invalidSessionCredential(err)
	}
	return session, nil
}

// GetMySession reads the cookie's session, held to project_id when the caller
// names one (mySession).
func (h Handler) GetMySession(ctx context.Context, params api.GetMySessionParams) (api.GetMySessionRes, error) {
	session, err := h.mySession(ctx, params.ProjectID, true)
	if err != nil {
		return nil, err
	}
	return &api.SessionResponseHeaders{
		CacheControl: api.NewOptString(sessionStateCacheControl),
		Response:     *sessionToAPI(session),
	}, nil
}

// GetMySessionCsrfToken hands the cookie's session its CSRF token (ADR 053 §5).
// The session is held to project_id and read and checked the way GetMySession
// does, so a session of another project, or a revoked or superseded cookie,
// gets no token.
func (h Handler) GetMySessionCsrfToken(ctx context.Context, params api.GetMySessionCsrfTokenParams) (api.GetMySessionCsrfTokenRes, error) {
	cookie, hasCookie := sessionCookieFromContext(ctx)
	if !hasCookie {
		return nil, invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}
	if _, err := h.mySession(ctx, params.ProjectID, false); err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			return nil, invalidSessionCredential(err)
		}
		return nil, err
	}
	return &api.CsrfTokenResponseHeaders{
		CacheControl: api.NewOptString(sessionStateCacheControl),
		Response:     api.CsrfTokenResponse{CsrfToken: CSRFToken(cookie)},
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
	// operator, so the caller's own session cookie is unrelated to the revoked
	// session. Clearing it here signs the operator out. Cookie clearing
	// belongs to RevokeMySession, which acts on the cookie's own session.
	return &api.RevokeSessionNoContent{}, nil
}

// RevokeMySession deletes the cookie's session and clears the cookie. With
// project_id, a session of another project is neither deleted nor cleared
// (mySession): signing out of one app must not end a session the browser holds
// for another.
func (h Handler) RevokeMySession(ctx context.Context, params api.RevokeMySessionParams) (api.RevokeMySessionRes, error) {
	session, err := h.mySession(ctx, params.ProjectID, false)
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			// The session is already gone; logout is idempotent. Clear the cookie
			// and return 204 rather than surfacing a 404 for an absent session.
			return &api.RevokeMySessionNoContent{SetCookie: deleteSessionCookie(ctx)}, nil
		}
		return nil, err
	}

	err = h.sessionService.Delete(ctx, service.DeleteSessionInput{
		ProjectID: session.ProjectID,
		SessionID: session.ID,
	})
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
	// Secure follows the request scheme so Safari can keep the cookie on
	// http://localhost (see cookieSecureFromContext), and the name with it.
	secure := cookieSecureFromContext(ctx)
	c := &http.Cookie{
		Name:     sessionCookieNameFor(secure),
		Value:    token,
		HttpOnly: true,
		Secure:   secure,
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
	case domain.ErrSessionExchangeConflict().Code,
		domain.ErrSessionInvalidHandoffToken().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrSessionTokenInvalid().Code:
		return errorResponseWithStatusCode(http.StatusUnauthorized, err)
	case domain.ErrSessionPermissionDenied().Code,
		domain.ErrSessionProjectMismatch().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
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
