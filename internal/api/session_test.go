package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/ogenx"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

func TestValidateSessionToken(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	session := &domain.Session{
		TokenID:   "tkn_100",
		ExpiresAt: now.Add(time.Hour),
	}
	token := &domain.Token{
		TokenID:   "tkn_100",
		ExpiresAt: new(now.Add(time.Hour)),
	}

	require.NoError(t, validateSessionToken(session, token))

	token.TokenID = "tkn_99"
	require.ErrorIs(t, validateSessionToken(session, token), domain.ErrSessionTokenInvalid())

	token.TokenID = "tkn_100"
	session.ExpiresAt = now.Add(-time.Minute)
	require.ErrorIs(t, validateSessionToken(session, token), domain.ErrSessionTokenInvalid())
}

func TestInvalidSessionCredential(t *testing.T) {
	t.Parallel()

	err := invalidSessionCredential(domain.ErrSessionTokenInvalid())
	require.ErrorIs(t, err, domain.ErrAuthUnauthorized(nil))
	require.ErrorIs(t, err, domain.ErrSessionTokenInvalid())
	require.Equal(t, "auth.unauthorized", err.Code)
	require.Equal(t, sessionUnauthorizedMessage, err.Message)
}

// TestGetMySessionHoldsTheSessionToTheNamedProject drives GET /sessions/me
// through the generated server. With project_id, a session of another project
// is refused with 403 sess.project_mismatch before it is looked up; a session
// of the named project, or a read that names none, is served as before.
func TestGetMySessionHoldsTheSessionToTheNamedProject(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		query      string
		wantStatus int
	}{
		{name: "a session of another project", query: "?project_id=proj_app", wantStatus: http.StatusForbidden},
		{name: "a session of the named project", query: "?project_id=proj_other", wantStatus: http.StatusOK},
		{name: "a read that names no project", query: "", wantStatus: http.StatusOK},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctrl := gomock.NewController(t)
			sid := "sess_1"
			tokens := servicemocks.NewMockTokenService(ctrl)
			tokens.EXPECT().IntrospectToken(gomock.Any(), "cookie").Return(&domain.Token{
				Type:      domain.TokenTypeSessionToken,
				ProjectID: "proj_other",
				SessionID: &sid,
				TokenID:   "tkn_1",
				UserID:    "user_1",
			}, nil)
			// No expectation on the refused read: a lookup would fail the test.
			sessions := servicemocks.NewMockSessionService(ctrl)
			if tc.wantStatus == http.StatusOK {
				sessions.EXPECT().
					Get(gomock.Any(), service.GetSessionInput{ProjectID: "proj_other", SessionID: sid, WithUserIdentity: true}).
					Return(&domain.Session{
						ProjectID: "proj_other",
						ID:        sid,
						TokenID:   "tkn_1",
						UserID:    new("user_1"),
						ExpiresAt: time.Now().Add(time.Hour),
					}, nil)
			}
			srv, err := api.NewServer(&Handler{sessionService: sessions}, NewSecurityHandler(tokens), api.WithErrorHandler(OgenErrorHandler))
			require.NoError(t, err)

			req := httptest.NewRequest(http.MethodGet, "/sessions/me"+tc.query, nil)
			req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "cookie"})
			rec := httptest.NewRecorder()
			WithCSRFRequest(srv).ServeHTTP(rec, req)

			require.Equal(t, tc.wantStatus, rec.Code, rec.Body.String())
			if tc.wantStatus == http.StatusForbidden {
				require.JSONEq(t,
					`{"code":"sess.project_mismatch","message":"The session belongs to a different project."}`,
					rec.Body.String(),
				)
			}
		})
	}
}

// RevokeMySession is idempotent: logging out a session that is already gone
// still returns 204 and clears the cookie, rather than surfacing a 404.
func TestRevokeMySession_IdempotentWhenSessionGone(t *testing.T) {
	t.Parallel()

	ctrl := gomock.NewController(t)
	sessions := servicemocks.NewMockSessionService(ctrl)
	sessions.EXPECT().
		Get(gomock.Any(), gomock.Any()).
		Return(nil, domain.ErrSessionNotFound())

	h := Handler{sessionService: sessions}

	sid := "sess_1"
	ctx := context.WithValue(t.Context(), sessionTokenKey{}, &domain.Token{
		Type:      domain.TokenTypeSessionToken,
		ProjectID: "proj_1",
		SessionID: &sid,
		TokenID:   "tkn_1",
	})

	res, err := h.RevokeMySession(ctx)
	require.NoError(t, err)
	nc, ok := res.(*api.RevokeMySessionNoContent)
	require.True(t, ok, "want 204 no-content, got %T", res)
	require.NotEmpty(t, nc.SetCookie, "cookie should be cleared on idempotent logout")
}

func TestUserAgentToAPI(t *testing.T) {
	t.Parallel()

	opt := userAgentToAPI(&domain.UserAgent{
		ID: "fp_abc123",
		IP: "203.0.113.42",
		Info: map[string]any{
			"browser":     "test",
			"fingerprint": "shadow",
			"ip":          "shadow-ip",
		},
	})

	ua, ok := opt.Get()
	require.True(t, ok)
	require.Equal(t, "fp_abc123", ua.GetFingerprint().Value)
	require.Equal(t, "203.0.113.42", ua.GetIP().Value)
	require.Contains(t, ua.AdditionalProps, "browser")
	require.NotContains(t, ua.AdditionalProps, "fingerprint")
	require.NotContains(t, ua.AdditionalProps, "ip")

	data, err := json.Marshal(&ua)
	require.NoError(t, err)
	require.JSONEq(t, `{"fingerprint":"fp_abc123","ip":"203.0.113.42","browser":"test"}`, string(data))
}

func TestSessionStateToAPI(t *testing.T) {
	t.Parallel()

	for _, tt := range []struct {
		name  string
		state domain.SessionState
		want  api.SessionResponseState
	}{
		{"unspecified", domain.SessionStateUnspecified, api.SessionResponseStateBuilding},
		{"building", domain.SessionStateBuilding, api.SessionResponseStateBuilding},
		{"active", domain.SessionStateActive, api.SessionResponseStateActive},
		{"expired", domain.SessionStateExpired, api.SessionResponseStateExpired},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			require.Equal(t, tt.want, sessionStateToAPI(tt.state))
		})
	}
}

func TestExchangeInputFromRequest(t *testing.T) {
	t.Parallel()

	t.Run("maps duration ttl", func(t *testing.T) {
		key := "idem-1"
		input, err := exchangeInputFromRequest(
			&api.ExchangeRequest{
				HandoffToken: "token-1",
				TTL:          api.NewOptDuration(ogenx.ISODuration(2 * time.Hour)),
			},
			api.ExchangeHandoffParams{
				ProjectID:      "proj-1",
				IdempotencyKey: api.NewOptString(key),
			},
		)
		require.NoError(t, err)
		require.EqualValues(t, "proj-1", input.ProjectID)
		require.Equal(t, "token-1", input.HandoffToken)
		require.NotNil(t, input.TTL)
		require.Equal(t, 2*time.Hour, *input.TTL)
		require.NotNil(t, input.IdempotencyKey)
		require.Equal(t, key, *input.IdempotencyKey)
	})

	t.Run("omitted ttl remains nil", func(t *testing.T) {
		input, err := exchangeInputFromRequest(
			&api.ExchangeRequest{
				HandoffToken: "token-1",
			},
			api.ExchangeHandoffParams{
				ProjectID: "proj-1",
			},
		)
		require.NoError(t, err)
		require.Nil(t, input.TTL)
		require.Nil(t, input.IdempotencyKey)
	})
}

// recordingEnsurer captures the ensure calls the exchange makes.
type recordingEnsurer struct {
	calls []string
	err   error
}

func (r *recordingEnsurer) EnsurePersonalTeam(_ context.Context, projectID, userID string) error {
	r.calls = append(r.calls, projectID+"/"+userID)
	return r.err
}

// exchangeFixture drives ExchangeHandoff far enough to observe the ensure.
// GetProjectCrypter is stubbed to fail on purpose: it runs after the ensure, so
// its error proves the handler got past the side effect without needing a real
// crypter, and it is the value the "ensure failure is non-fatal" case compares
// against.
func exchangeFixture(t *testing.T, session *domain.Session, ens service.PersonalTeamEnsurer) (Handler, error) {
	t.Helper()
	ctrl := gomock.NewController(t)

	sessions := servicemocks.NewMockSessionService(ctrl)
	sessions.EXPECT().Exchange(gomock.Any(), gomock.Any()).Return(session, nil)

	crypterErr := errors.New("crypter unavailable")
	keys := servicemocks.NewMockKeyService(ctrl)
	keys.EXPECT().GetProjectCrypter(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil, crypterErr).AnyTimes()

	h := Handler{sessionService: sessions, keyService: keys}
	if ens != nil {
		h.WithPersonalTeamEnsurer(ens)
	}
	return h, crypterErr
}

func exchangedSession(userID *string) *domain.Session {
	return &domain.Session{
		ProjectID: "proj_platform",
		ID:        "sess_1",
		TokenID:   "tkn_1",
		ExpiresAt: time.Now().Add(time.Hour),
		UserID:    userID,
	}
}

func callExchange(t *testing.T, h Handler) error {
	t.Helper()
	_, err := h.ExchangeHandoff(t.Context(),
		&api.ExchangeRequest{HandoffToken: "handoff"},
		api.ExchangeHandoffParams{ProjectID: "proj_platform"})
	return err
}

// TestExchangeHandoffRunsThePersonalTeamEnsure pins the handler wiring itself.
// Session exchange is the only place the ensure runs, so a dropped call here
// would silently stop provisioning without any service test noticing.
func TestExchangeHandoffRunsThePersonalTeamEnsure(t *testing.T) {
	t.Parallel()

	ens := &recordingEnsurer{}
	h, crypterErr := exchangeFixture(t, exchangedSession(new("user_1")), ens)

	require.ErrorIs(t, callExchange(t, h), crypterErr)
	require.Equal(t, []string{"proj_platform/user_1"}, ens.calls,
		"the exchanged session's project and user are what the ensure is scoped to")
}

// TestExchangeHandoffSkipsTheEnsureForAnonymousSessions: a session with no
// resolved user has nobody to provision a team for.
func TestExchangeHandoffSkipsTheEnsureForAnonymousSessions(t *testing.T) {
	t.Parallel()

	ens := &recordingEnsurer{}
	h, crypterErr := exchangeFixture(t, exchangedSession(nil), ens)

	require.ErrorIs(t, callExchange(t, h), crypterErr)
	require.Empty(t, ens.calls)
}

// TestExchangeHandoffSurvivesAnEnsureFailure: the side effect is best-effort,
// so a failing ensure must not cost the sign-in. The handler must fail no
// earlier than it would have without the ensurer, and never with its error.
func TestExchangeHandoffSurvivesAnEnsureFailure(t *testing.T) {
	t.Parallel()

	ensureErr := errors.New("ensure exploded")
	ens := &recordingEnsurer{err: ensureErr}
	h, crypterErr := exchangeFixture(t, exchangedSession(new("user_1")), ens)

	err := callExchange(t, h)
	require.ErrorIs(t, err, crypterErr, "the exchange continued past the failed side effect")
	require.NotErrorIs(t, err, ensureErr, "the side effect's failure must not surface to the caller")
}

// TestExchangeHandoffWithoutAnEnsurerIsUnchanged: the setter is optional, so a
// handler built without it must behave exactly as before it existed.
func TestExchangeHandoffWithoutAnEnsurerIsUnchanged(t *testing.T) {
	t.Parallel()

	h, crypterErr := exchangeFixture(t, exchangedSession(new("user_1")), nil)
	require.ErrorIs(t, callExchange(t, h), crypterErr)
}
