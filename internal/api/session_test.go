package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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

// TestMySessionHoldsTheSessionToTheNamedProject drives the /sessions/me
// operations through the generated server. With project_id, a session of
// another project is refused with 403 sess.project_mismatch before it is looked
// up, and the refusal clears no cookie; a session of the named project, or a
// request that names none, is served as before.
func TestMySessionHoldsTheSessionToTheNamedProject(t *testing.T) {
	t.Parallel()

	operations := []struct {
		name   string
		method string
		path   string
		// withUser: the operation reads the session with the user's identity.
		withUser bool
		served   int
	}{
		{name: "read", method: http.MethodGet, path: "/sessions/me", withUser: true, served: http.StatusOK},
		{name: "csrf token", method: http.MethodGet, path: "/sessions/me/csrf", served: http.StatusOK},
		{name: "sign-out", method: http.MethodDelete, path: "/sessions/me", served: http.StatusNoContent},
	}
	tests := []struct {
		name    string
		query   string
		refused bool
	}{
		{name: "a session of another project", query: "?project_id=proj_app", refused: true},
		{name: "a session of the named project", query: "?project_id=proj_other"},
		{name: "a request that names no project", query: ""},
	}
	for _, op := range operations {
		for _, tc := range tests {
			t.Run(op.name+"/"+tc.name, func(t *testing.T) {
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
				// No expectation on a refused request: a lookup would fail the test.
				sessions := servicemocks.NewMockSessionService(ctrl)
				if !tc.refused {
					sessions.EXPECT().
						Get(gomock.Any(), service.GetSessionInput{ProjectID: "proj_other", SessionID: sid, WithUserIdentity: op.withUser}).
						Return(&domain.Session{
							ProjectID: "proj_other",
							ID:        sid,
							TokenID:   "tkn_1",
							UserID:    new("user_1"),
							ExpiresAt: time.Now().Add(time.Hour),
						}, nil)
					if op.method == http.MethodDelete {
						sessions.EXPECT().
							Delete(gomock.Any(), service.DeleteSessionInput{ProjectID: "proj_other", SessionID: sid}).
							Return(nil)
					}
				}
				srv, err := api.NewServer(&Handler{sessionService: sessions}, NewSecurityHandler(tokens), api.WithErrorHandler(OgenErrorHandler))
				require.NoError(t, err)

				req := httptest.NewRequest(op.method, op.path+tc.query, nil)
				req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "cookie"})
				// Sign-out is a write: the hold is checked once the token passed.
				req.Header.Set(CSRFHeader, CSRFToken("cookie"))
				rec := httptest.NewRecorder()
				WithCSRFRequest(srv).ServeHTTP(rec, req)

				if !tc.refused {
					require.Equal(t, op.served, rec.Code, rec.Body.String())
					return
				}
				require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
				require.JSONEq(t,
					`{"code":"sess.project_mismatch","message":"The session belongs to a different project."}`,
					rec.Body.String(),
				)
				require.Empty(t, rec.Header().Values("Set-Cookie"), "the session of another project keeps its cookie")
			})
		}
	}
}

// TestMyUserHoldsTheSessionToTheNamedProject drives the operations on the
// cookie's user (/users/me) through the generated server the same way: with
// project_id, a session of another project is refused with 403
// sess.project_mismatch before the user or its projects are looked up, and the
// refusal clears no cookie; a session of the named project, or a request that
// names none, is served as before.
func TestMyUserHoldsTheSessionToTheNamedProject(t *testing.T) {
	t.Parallel()

	operations := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "read", method: http.MethodGet, path: "/users/me"},
		{name: "patch", method: http.MethodPatch, path: "/users/me", body: `{"attributes":{"nickname":"Myself"}}`},
		{name: "projects", method: http.MethodGet, path: "/users/me/projects"},
	}
	tests := []struct {
		name    string
		query   string
		refused bool
	}{
		{name: "a session of another project", query: "?project_id=proj_app", refused: true},
		{name: "a session of the named project", query: "?project_id=proj_other"},
		{name: "a request that names no project", query: ""},
	}
	for _, op := range operations {
		for _, tc := range tests {
			t.Run(op.name+"/"+tc.name, func(t *testing.T) {
				t.Parallel()

				ctrl := gomock.NewController(t)
				sid := "sess_1"
				token := &domain.Token{
					Type:      domain.TokenTypeSessionToken,
					ProjectID: "proj_other",
					SessionID: &sid,
					TokenID:   "tkn_1",
					UserID:    "user_1",
				}
				tokens := servicemocks.NewMockTokenService(ctrl)
				tokens.EXPECT().IntrospectToken(gomock.Any(), "cookie").Return(token, nil)
				// No expectation on a refused request: a lookup would fail the test.
				users := &myUserService{}
				projects := servicemocks.NewMockProjectService(ctrl)
				if !tc.refused && op.path == "/users/me/projects" {
					projects.EXPECT().
						ListAuthorized(gomock.Any(), service.ListAuthorizedProjectsRequest{HomeProjectID: "proj_other", UserID: "user_1", Limit: 20}).
						Return(&service.ListProjectsResponse{}, nil)
				}
				srv, err := api.NewServer(&Handler{userService: users, projectService: projects}, NewSecurityHandler(tokens), api.WithErrorHandler(OgenErrorHandler))
				require.NoError(t, err)

				req := httptest.NewRequest(op.method, op.path+tc.query, strings.NewReader(op.body))
				req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "cookie"})
				if op.body != "" {
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set(CSRFHeader, CSRFToken("cookie"))
				}
				rec := httptest.NewRecorder()
				WithCSRFRequest(srv).ServeHTTP(rec, req)

				if !tc.refused {
					require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
					if op.path == "/users/me" {
						self, err := domain.SelfFromSession(token, time.Now())
						require.NoError(t, err)
						require.Equal(t, []domain.Self{self}, users.served, "the user is the session's")
					}
					return
				}
				require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
				require.JSONEq(t,
					`{"code":"sess.project_mismatch","message":"The session belongs to a different project."}`,
					rec.Body.String(),
				)
				require.Empty(t, rec.Header().Values("Set-Cookie"), "the session of another project keeps its cookie")
				require.Empty(t, users.served, "a refused request reads and changes no user")
			})
		}
	}
}

// myUserService answers the reads and patches of the cookie's user and records
// the caller each was asked for. Any other method panics.
type myUserService struct {
	service.UserService
	served []domain.Self
}

func (s *myUserService) GetMyUser(_ context.Context, input service.GetMyUserInput) (*domain.User, error) {
	s.served = append(s.served, input.Self)
	return myUser(input.Self), nil
}

func (s *myUserService) PatchMyUser(_ context.Context, input service.PatchMyUserInput) (*domain.User, error) {
	s.served = append(s.served, input.Self)
	return myUser(input.Self), nil
}

func myUser(self domain.Self) *domain.User {
	return &domain.User{
		ProjectID: self.ProjectID(),
		ID:        self.UserID(),
		SchemaURL: "sch_1",
		Metadata:  domain.UserMetadata{Status: domain.UserStatusActive},
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

	res, err := h.RevokeMySession(ctx, api.RevokeMySessionParams{})
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
