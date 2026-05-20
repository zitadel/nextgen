package api

import (
	"context"
	"fmt"
	"time"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
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
	return sessionWithTokenToAPI(session), nil
}

func (h Handler) ExchangeHandoff(ctx context.Context, req *api.ExchangeRequest, params api.ExchangeHandoffParams) (api.ExchangeHandoffRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	input := service.ExchangeInput{
		ProjectID:    scopeCtx.ProjectID,
		HandoffToken: req.HandoffToken,
	}
	if key, ok := params.IdempotencyKey.Get(); ok {
		input.IdempotencyKey = new(key)
	}
	session, err := h.sessionService.Exchange(ctx, input)
	if err != nil {
		return nil, err
	}
	return sessionWithTokenToAPI(session), nil
}

func (h Handler) GetSession(ctx context.Context, params api.GetSessionParams) (api.GetSessionRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	input := service.GetSessionInput{
		ProjectID: scopeCtx.ProjectID,
		SessionID: string(params.SessionID),
	}

	session, err := h.sessionService.Get(ctx, input)
	if err != nil {
		return nil, err
	}
	return sessionToAPI(session), nil
}

func (h Handler) GetMySession(ctx context.Context, params api.GetMySessionParams) (api.GetMySessionRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	cookie := params.NextgenSession // TODO: handle cookie
	input := service.GetSessionInput{
		ProjectID: scopeCtx.ProjectID,
		//SessionID: string(params.SessionID),
	}
	_ = cookie

	session, err := h.sessionService.Get(ctx, input)
	if err != nil {
		return nil, err
	}
	return sessionToAPI(session), nil
}

func (h Handler) ListSessions(ctx context.Context, params api.ListSessionsParams) (api.ListSessionsRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	input := service.ListSessionInput{
		ProjectID: scopeCtx.ProjectID,
		// TODO: handle params
	}
	sessions, err := h.sessionService.List(ctx, input)
	if err != nil {
		return nil, err
	}
	return sessionsToAPI(sessions), nil
}

func (h Handler) RevokeSession(ctx context.Context, params api.RevokeSessionParams) (api.RevokeSessionRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	input := service.DeleteSessionInput{
		ProjectID: scopeCtx.ProjectID,
		SessionID: string(params.SessionID),
	}

	err := h.sessionService.Delete(ctx, input)
	if err != nil {
		return nil, err
	}
	return &api.RevokeSessionNoContent{
		SetCookie: deleteSessionCookie(),
	}, nil
}

func (h Handler) RevokeMySession(ctx context.Context, params api.RevokeMySessionParams) (api.RevokeMySessionRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	cookie := params.NextgenSession // TODO: handle cookie
	input := service.DeleteSessionInput{
		ProjectID: scopeCtx.ProjectID,
		//SessionID: string(params.SessionID),
	}
	_ = cookie

	err := h.sessionService.Delete(ctx, input)
	if err != nil {
		return nil, err
	}
	return &api.RevokeMySessionNoContent{
		SetCookie: deleteSessionCookie(),
	}, nil
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

func sessionWithTokenToAPI(session *domain.Session) *api.SessionWithTokenResponseHeaders {
	var token string // TODO: !
	return &api.SessionWithTokenResponseHeaders{
		SetCookie: setSessionCookie(token, session.ExpiresAt),
		Response: api.SessionWithTokenResponse{
			Session:      *sessionToAPI(session),
			SessionToken: token,
		},
	}
}

func sessionToAPI(session *domain.Session) *api.SessionResponse {
	factors := make(api.SessionResponseFactors, len(session.Factors))
	for _, factor := range session.Factors {
		_ = factor // TODO: !
	}
	return &api.SessionResponse{
		SessionID:       api.SessionID(session.ID),
		ProjectID:       api.ProjectID(session.ProjectID),
		State:           sessionStateToAPI(session.State),
		UserID:          api.OptNilUserID{},
		Factors:         factors,
		AssuranceLevels: nil,                                 // TODO: ?!
		Metadata:        api.OptNilSessionResponseMetadata{}, // TODO: ?!
		UserAgent:       userAgentToAPI(session.UserAgent),
		CreatedAt:       session.CreatedAt,
		ExpiresAt:       session.ExpiresAt,
	}
}

func userAgentToAPI(agent *domain.UserAgent) api.OptNilSessionResponseUserAgent {
	if agent == nil {
		return api.OptNilSessionResponseUserAgent{}
	}
	info := make(map[string]jx.Raw)
	for key, value := range agent.Info {
		info[key] = jx.Raw(fmt.Sprintf("%v", value))
	}
	return api.NewOptNilSessionResponseUserAgent(api.SessionResponseUserAgent{
		Fingerprint:     api.NewOptString(agent.ID),
		IP:              api.NewOptString(agent.IP),
		AdditionalProps: info,
	})
}

func sessionStateToAPI(state domain.SessionState) api.SessionResponseState {
	switch state {
	case domain.SessionStateUnspecified:
		return api.SessionResponseStateBuilding
	case domain.SessionStateActive:
		return api.SessionResponseStateActive
	case domain.SessionStateBuilding:
		return api.SessionResponseStateBuilding
	case domain.SessionStateExpired:
		return api.SessionResponseStateExpired
	default:
		return api.SessionResponseStateRevoked // TODO: ?
	}
}

func sessionsToAPI(sessions []*domain.Session) *api.SessionListResponse {
	response := &api.SessionListResponse{
		Sessions: make([]api.SessionResponse, len(sessions)),
	}
	for i, session := range sessions {
		response.Sessions[i] = *sessionToAPI(session)
	}
	return response
}

func setSessionCookie(token string, expiresAt time.Time) string {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 0 {
		maxAge = 0
	}
	return sessionCookie(token, maxAge)
}

func deleteSessionCookie() string {
	return sessionCookie("", 0)
}

func sessionCookie(token string, maxAge int) string {
	return fmt.Sprintf("__nextgen_session=%s; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=%d", token, maxAge)
}
