package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

	return sessionWithTokenToAPI(session, tokenCrypter)
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

	tokenCrypter, err := h.keyService.GetProjectCrypter(ctx, string(params.ProjectID), domain.EncryptionKeyPurposeToken)
	if err != nil {
		return nil, err
	}

	return sessionWithTokenToAPI(session, tokenCrypter)
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
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), sessionAccess, opRead); err != nil {
		return nil, err
	}
	input := service.GetSessionInput{
		ProjectID: string(params.ProjectID),
		SessionID: string(params.SessionID),
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
	input := service.ListSessionInput{
		ProjectID: string(params.ProjectID),
		// TODO: handle req
	}
	sessions, err := h.sessionService.List(ctx, input)
	if err != nil {
		return nil, err
	}
	return sessionsToAPI(sessions), nil
}

func (h Handler) RevokeSession(ctx context.Context, params api.RevokeSessionParams) (api.RevokeSessionRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), sessionAccess, opDelete); err != nil {
		return nil, err
	}
	input := service.DeleteSessionInput{
		ProjectID: string(params.ProjectID),
		SessionID: string(params.SessionID),
	}

	err := h.sessionService.Delete(ctx, input)
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
			return &api.RevokeMySessionNoContent{SetCookie: deleteSessionCookie()}, nil
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
		SetCookie: deleteSessionCookie(),
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

func sessionWithTokenToAPI(session *domain.Session, encrypter op.Encrypter) (*api.SessionWithTokenResponseHeaders, error) {
	token, err := session.Token(encrypter)
	if err != nil {
		return nil, err
	}
	return &api.SessionWithTokenResponseHeaders{
		SetCookie: setSessionCookie(token, session.ExpiresAt),
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
		if name := session.User.DisplayName(); name != "" {
			resp.Name = api.NewOptString(name)
		}
		if email := session.User.Email(); email != "" {
			resp.Email = api.NewOptString(email)
		}
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

func setSessionCookie(token string, expiresAt time.Time) string {
	maxAge := max(int(time.Until(expiresAt).Seconds()), 0)
	return sessionCookie(token, maxAge)
}

func deleteSessionCookie() string {
	return sessionCookie("", 0)
}

func sessionCookie(token string, maxAge int) string {
	return fmt.Sprintf("%s=%s; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=%d", sessionCookieName, token, maxAge)
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
