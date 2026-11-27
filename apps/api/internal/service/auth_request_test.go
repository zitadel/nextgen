package service_test

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestAuthRequestService_Create(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		createErr error
		emitErr   error
		wantErr   error
	}{
		{name: "stored"},
		{name: "storage_unavailable", createErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable()},
		{name: "storage_fails", createErr: errors.New("boom"), wantErr: domain.ErrInternal(nil)},
		{name: "emit_fails", emitErr: errors.New("boom"), wantErr: domain.ErrInternal(nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			pool := servicemocks.NewMockPool(ctrl)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
			pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
				func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
					return fn(ctx, statementer)
				},
			)
			statementer.EXPECT().Statements().Return(stmts).AnyTimes()
			stmts.EXPECT().CreateAuthRequest(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, r *domain.AuthRequest) error {
				r.ID = "authreq_1"
				return tt.createErr
			})
			var event *domain.Event
			if tt.createErr == nil {
				stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
					event = ev
					return tt.emitErr
				})
			}

			request := &domain.AuthRequest{ProjectID: "proj_1", ClientID: "shop", State: "xyz"}
			nonce, err := service.NewAuthRequestService(service.NewPool(pool), servicemocks.NewMockKeyService(ctrl)).Create(t.Context(), request)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Empty(t, nonce)
				return
			}
			require.NoError(t, err)
			assert.NotEmpty(t, nonce)
			assert.Equal(t, domain.HashSecret(nonce), request.BindingHash)
			assert.WithinDuration(t, time.Now().Add(domain.AuthRequestTTL), request.ExpiresAt, 5*time.Second)
			require.NotNil(t, event)
			assert.Equal(t, domain.EventTypeAuthRequestCreated, event.EventType)
			assert.Equal(t, domain.EventCategoryAuth, event.Category)
			assert.Equal(t, new("auth_request"), event.EntityType)
			assert.Equal(t, new("authreq_1"), event.EntityID)
			assert.JSONEq(t, `{"client_id":"shop"}`, string(event.Payload))
		})
	}
}

func TestAuthRequestService_IssueCode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		userID    string
		sessionID string
		// deploymentID is the stored request's; the code names it first.
		deploymentID string
		getErr       error
		setErr       error
		wantErr      error
	}{
		{name: "issued", userID: "user_1", sessionID: "sess_1", deploymentID: "dep_1"},
		{name: "issued_without_deployment", userID: "user_1", sessionID: "sess_1"},
		{name: "unknown_request", userID: "user_1", sessionID: "sess_1", getErr: database.NewNoRowFoundError(nil), wantErr: domain.ErrAuthCodeNotIssued()},
		{name: "read_unavailable", userID: "user_1", sessionID: "sess_1", getErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable()},
		{name: "read_fails", userID: "user_1", sessionID: "sess_1", getErr: errors.New("boom"), wantErr: domain.ErrInternal(nil)},
		{name: "no_user", sessionID: "sess_1", wantErr: domain.ErrInternal(nil)},
		{name: "no_session", userID: "user_1", wantErr: domain.ErrInternal(nil)},
		// The request is unknown, expired, or already has a code.
		{name: "no_row_changed", userID: "user_1", sessionID: "sess_1", setErr: database.NewNoRowFoundError(nil), wantErr: domain.ErrAuthCodeNotIssued()},
		{name: "storage_unavailable", userID: "user_1", sessionID: "sess_1", setErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable()},
		{name: "storage_fails", userID: "user_1", sessionID: "sess_1", setErr: errors.New("boom"), wantErr: domain.ErrInternal(nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			pool := servicemocks.NewMockPool(ctrl)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			var (
				stored    *domain.AuthRequest
				storedNow time.Time
			)
			if tt.userID != "" && tt.sessionID != "" {
				pool.EXPECT().Statements().Return(stmts).AnyTimes()
				stmts.EXPECT().GetAuthRequest(gomock.Any(), "proj_1", "authreq_1").
					Return(&domain.AuthRequest{ProjectID: "proj_1", ID: "authreq_1", DeploymentID: tt.deploymentID}, tt.getErr)
			}
			if tt.userID != "" && tt.sessionID != "" && tt.getErr == nil {
				stmts.EXPECT().SetAuthRequestCode(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, r *domain.AuthRequest, now time.Time) error {
					stored, storedNow = r, now
					return tt.setErr
				})
			}

			code, err := service.NewAuthRequestService(service.NewPool(pool), servicemocks.NewMockKeyService(ctrl)).
				IssueCode(t.Context(), "proj_1", "authreq_1", tt.userID, tt.sessionID)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Empty(t, code)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, stored)
			assert.Equal(t, tt.deploymentID, domain.AuthCodeDeploymentID(code), "the code names the request's deployment")
			assert.Equal(t, "proj_1", stored.ProjectID)
			assert.Equal(t, "authreq_1", stored.ID)
			assert.Equal(t, domain.HashSecret(code), stored.CodeHash)
			assert.Equal(t, "user_1", stored.UserID)
			assert.Equal(t, "sess_1", stored.SessionID)
			require.NotNil(t, stored.CodeExpiresAt)
			// The statement refuses a request expired at storedNow.
			assert.WithinDuration(t, time.Now(), storedNow, 5*time.Second)
			assert.True(t, storedNow.Add(domain.AuthCodeTTL).Equal(*stored.CodeExpiresAt), "the code expires a TTL after now")
			assert.Equal(t, time.UTC, stored.CodeExpiresAt.Location())
		})
	}
}

const (
	redeemVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	redeemCode     = "the-code"
)

// redeemReach is the last step of a redemption a case reaches.
type redeemReach int

const (
	reachRedeem redeemReach = iota
	reachRelease
	reachSession
	reachUser
	reachIssue
)

func TestAuthRequestService_RedeemCode(t *testing.T) {
	t.Parallel()
	boom := errors.New("boom")
	tests := []struct {
		name   string
		change func(*domain.AuthRequest, *service.RedeemCodeInput)
		// release and session replace the stored ones when set.
		release *domain.Release
		session *domain.Session
		// Each fault is returned by the step of its name.
		redeemErr, releaseErr, sessionErr, userErr, idErr, emitErr error
		signer                                                     jose.Signer
		reach                                                      redeemReach
		wantErr                                                    error
		// wantMessage is the message of the outermost domain error, when set.
		wantMessage string
		// wantRollback is a fault: the callback returns it, so the code stays.
		wantRollback bool
		// retried runs the callback twice, as Spanner does after an abort: the
		// first run finds no code, the second redeems it.
		retried bool
		// wantReason is the reason of the auth.request.exchange.failed event a
		// refusal of a consumed code writes.
		wantReason string
	}{
		// activeSession expires in an hour, after the token.
		{name: "issued", reach: reachIssue},
		{
			// The token never outlives its session.
			name: "issued_until_the_session_expires",
			session: func() *domain.Session {
				s := activeSession(new("user_1"))
				s.ExpiresAt = time.Now().Add(2 * time.Minute)
				return s
			}(),
			reach: reachIssue,
		},
		{
			// A token for it would have exp equal to iat.
			name: "session_ends_within_a_second",
			session: func() *domain.Session {
				s := activeSession(new("user_1"))
				s.ExpiresAt = time.Now().Add(400 * time.Millisecond)
				return s
			}(),
			reach:      reachSession,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonSessionNotActive,
		},
		{
			name: "issued_for_a_session_without_expiry",
			session: func() *domain.Session {
				s := activeSession(new("user_1"))
				s.ExpiresAt = time.Time{}
				return s
			}(),
			reach: reachIssue,
		},
		{name: "issued_on_retry", retried: true, reach: reachIssue},
		{
			name:   "issued_with_scopes",
			change: func(r *domain.AuthRequest, _ *service.RedeemCodeInput) { r.Scopes = []string{"read", "write"} },
			reach:  reachIssue,
		},
		{
			name:   "issued_without_pkce",
			change: func(r *domain.AuthRequest, in *service.RedeemCodeInput) { r.CodeChallenge, in.CodeVerifier = "", "" },
			reach:  reachIssue,
		},
		{
			name:   "issued_without_release",
			change: func(r *domain.AuthRequest, _ *service.RedeemCodeInput) { r.ReleaseID = "" },
			reach:  reachIssue,
		},
		{name: "unknown_code", redeemErr: database.NewNoRowFoundError(nil), wantErr: domain.ErrAuthCodeInvalid()},
		{
			name:       "other_client",
			change:     func(_ *domain.AuthRequest, in *service.RedeemCodeInput) { in.ClientID = "other" },
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonClientMismatch,
		},
		{
			name: "expired",
			change: func(r *domain.AuthRequest, _ *service.RedeemCodeInput) {
				r.CodeExpiresAt = new(time.Now().Add(-time.Second))
			},
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonCodeExpired,
		},
		{
			name:       "no_code_expiry",
			change:     func(r *domain.AuthRequest, _ *service.RedeemCodeInput) { r.CodeExpiresAt = nil },
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonCodeExpired,
		},
		{
			// The client is checked before the redirect URI.
			name: "other_client_and_redirect_uri",
			change: func(_ *domain.AuthRequest, in *service.RedeemCodeInput) {
				in.ClientID = "other"
				in.RedirectURI += "/"
			},
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonClientMismatch,
		},
		{
			name:       "other_redirect_uri",
			change:     func(_ *domain.AuthRequest, in *service.RedeemCodeInput) { in.RedirectURI += "/" },
			wantErr:    domain.ErrAuthCodeRedirectURIMismatch(),
			wantReason: domain.AuthRequestExchangeReasonRedirectURIMismatch,
		},
		{
			name:       "verifier_missing",
			change:     func(_ *domain.AuthRequest, in *service.RedeemCodeInput) { in.CodeVerifier = "" },
			wantErr:    domain.ErrAuthCodeVerifierMissing(),
			wantReason: domain.AuthRequestExchangeReasonCodeVerifierMissing,
		},
		{
			name:       "verifier_wrong",
			change:     func(_ *domain.AuthRequest, in *service.RedeemCodeInput) { in.CodeVerifier += "x" },
			wantErr:    domain.ErrAuthCodeVerifierInvalid(),
			wantReason: domain.AuthRequestExchangeReasonCodeVerifierInvalid,
		},
		{
			name:       "verifier_without_challenge",
			change:     func(r *domain.AuthRequest, _ *service.RedeemCodeInput) { r.CodeChallenge = "" },
			wantErr:    domain.ErrAuthCodeVerifierUnexpected(),
			wantReason: domain.AuthRequestExchangeReasonCodeVerifierUnexpected,
		},
		{
			name:       "release_revoked",
			release:    &domain.Release{ID: "rel_1", RevokedAt: new(time.Now())},
			reach:      reachRelease,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonReleaseRevoked,
		},
		{
			name:       "session_gone",
			sessionErr: domain.ErrSessionNotFound(),
			reach:      reachSession,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonSessionNotActive,
		},
		{
			name:       "session_not_active",
			session:    &domain.Session{ProjectID: "proj_1", ID: "sess_1", UserID: new("user_1")},
			reach:      reachSession,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonSessionNotActive,
		},
		{
			name: "session_expired",
			session: func() *domain.Session {
				s := activeSession(new("user_1"))
				s.ExpiresAt = time.Now().Add(-time.Second)
				return s
			}(),
			reach:      reachSession,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonSessionNotActive,
		},
		{
			name:       "session_of_another_user",
			session:    activeSession(new("user_2")),
			reach:      reachSession,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonSessionNotActive,
		},
		{
			name:       "session_without_user",
			session:    activeSession(nil),
			reach:      reachSession,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonSessionNotActive,
		},
		{
			name:       "user_not_active",
			userErr:    database.NewNoRowFoundError(nil),
			reach:      reachUser,
			wantErr:    domain.ErrAuthCodeInvalid(),
			wantReason: domain.AuthRequestExchangeReasonUserNotActive,
		},
		{
			// The refusal's event fails: the code it consumed is restored.
			name:         "refusal_event_fails",
			change:       func(_ *domain.AuthRequest, in *service.RedeemCodeInput) { in.ClientID = "other" },
			emitErr:      boom,
			wantErr:      domain.ErrInternal(nil),
			wantRollback: true,
			wantReason:   domain.AuthRequestExchangeReasonClientMismatch,
		},
		{name: "redeem_fails", redeemErr: boom, wantErr: domain.ErrInternal(nil), wantMessage: "failed to redeem the authorization code", wantRollback: true},
		{name: "redeem_unavailable", redeemErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable(), wantRollback: true},
		{name: "release_read_fails", releaseErr: boom, reach: reachRelease, wantErr: domain.ErrInternal(nil), wantRollback: true},
		{
			// A domain error that is not a server fault must not leave as a
			// refusal: it is a fault of the redemption.
			name:         "release_read_refused",
			releaseErr:   domain.ErrReleaseNotFound(),
			reach:        reachRelease,
			wantErr:      domain.ErrInternal(nil),
			wantMessage:  "failed to redeem the authorization code",
			wantRollback: true,
		},
		{name: "session_read_fails", sessionErr: boom, reach: reachSession, wantErr: domain.ErrInternal(nil), wantRollback: true},
		{name: "user_read_fails", userErr: boom, reach: reachUser, wantErr: domain.ErrInternal(nil), wantRollback: true},
		{name: "token_id_fails", idErr: boom, reach: reachIssue, wantErr: domain.ErrInternal(nil), wantRollback: true},
		{name: "signing_fails", signer: failingSigner{}, reach: reachIssue, wantErr: domain.ErrInternal(nil), wantMessage: "failed to sign the access token", wantRollback: true},
		{name: "event_fails", emitErr: boom, reach: reachIssue, wantErr: domain.ErrInternal(nil), wantRollback: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			pool := servicemocks.NewMockPool(ctrl)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
			keys := servicemocks.NewMockKeyService(ctrl)

			_, private, err := ed25519.GenerateKey(nil)
			require.NoError(t, err)
			keys.EXPECT().GetProjectSigner(gomock.Any(), "proj_1", domain.SigningKeyPurposeToken, gomock.Any()).DoAndReturn(
				func(_ context.Context, _ string, _ domain.SigningKeyPurpose, opts *jose.SignerOptions) (jose.Signer, error) {
					if tt.signer != nil {
						return tt.signer, nil
					}
					return jose.NewSigner(jose.SigningKey{Algorithm: jose.EdDSA, Key: jose.JSONWebKey{Key: private, KeyID: "sig_key_1"}}, opts)
				},
			)

			request := &domain.AuthRequest{
				ProjectID:     "proj_1",
				ID:            "authreq_1",
				ClientID:      "shop",
				RedirectURI:   "https://shop.example.com/callback",
				CodeChallenge: oidc.NewSHACodeChallenge(redeemVerifier),
				Issuer:        "https://shop.example.com/oauth/proj_1",
				ReleaseID:     "rel_1",
				CodeHash:      domain.HashSecret(redeemCode),
				UserID:        "user_1",
				SessionID:     "sess_1",
				CodeExpiresAt: new(time.Now().Add(domain.AuthCodeTTL)),
			}
			input := service.RedeemCodeInput{
				ProjectID:    "proj_1",
				ClientID:     "shop",
				Code:         redeemCode,
				RedirectURI:  "https://shop.example.com/callback",
				CodeVerifier: redeemVerifier,
			}
			if tt.change != nil {
				tt.change(request, &input)
			}
			release := &domain.Release{ID: "rel_1"}
			if tt.release != nil {
				release = tt.release
			}
			session := activeSession(new("user_1"))
			if tt.session != nil {
				session = tt.session
			}

			var callbackErr error
			pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
				func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
					if tt.retried {
						require.NoError(t, fn(ctx, statementer), "the first run refuses and returns nil")
					}
					callbackErr = fn(ctx, statementer)
					return callbackErr
				},
			)
			statementer.EXPECT().Statements().Return(stmts).AnyTimes()
			if tt.retried {
				stmts.EXPECT().RedeemAuthRequestCode(gomock.Any(), "proj_1", domain.HashSecret(redeemCode)).Return(nil, database.NewNoRowFoundError(nil))
			}
			stmts.EXPECT().RedeemAuthRequestCode(gomock.Any(), "proj_1", domain.HashSecret(redeemCode)).Return(request, tt.redeemErr)
			if request.ReleaseID != "" && tt.reach >= reachRelease {
				stmts.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(release, tt.releaseErr)
			}
			if tt.reach >= reachSession {
				stmts.EXPECT().GetSessionByID(gomock.Any(), "proj_1", "sess_1").Return(session, tt.sessionErr)
			}
			if tt.reach >= reachUser {
				stmts.EXPECT().GetUser(gomock.Any(), database.And(
					database.Equal(database.Col(domain.UserFieldProjectID), "proj_1"),
					database.Equal(database.Col(domain.UserFieldID), "user_1"),
					database.Equal(database.Col(domain.UserFieldStatus), domain.UserStatusActive.String()),
				), service.UserQueryOptions{}).Return(&domain.User{ID: "user_1"}, tt.userErr)
			}
			var events []*domain.Event
			insertEvent := func() {
				stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
					events = append(events, ev)
					return tt.emitErr
				})
			}
			if tt.wantReason != "" {
				insertEvent()
			}
			if tt.reach >= reachIssue {
				stmts.EXPECT().NewManagedID(string(domain.TokenPrefix)).Return("tkn_1", tt.idErr)
				if tt.idErr == nil && tt.signer == nil {
					insertEvent()
				}
			}

			before := time.Now()
			token, expiresIn, err := service.NewAuthRequestService(service.NewPool(pool), keys).RedeemCode(t.Context(), input)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Empty(t, token)
				assert.Zero(t, expiresIn)
				if tt.wantMessage != "" {
					outer, ok := errors.AsType[domain.Error](err)
					require.True(t, ok)
					assert.Equal(t, tt.wantMessage, outer.Message)
				}
				if tt.wantRollback {
					assert.Error(t, callbackErr, "a fault must roll the redemption back")
				} else {
					assert.NoError(t, callbackErr, "a refusal must commit the redemption")
				}
				if tt.wantReason == "" {
					for _, event := range events {
						assert.NotEqual(t, domain.EventTypeAuthRequestExchangeFailed, event.EventType, "no refusal of a consumed code")
					}
					return
				}
				require.Len(t, events, 1)
				event := events[0]
				assert.Equal(t, domain.EventTypeAuthRequestExchangeFailed, event.EventType)
				assert.Equal(t, domain.EventCategoryAuth, event.Category)
				assert.Equal(t, new("auth_request"), event.EntityType)
				assert.Equal(t, new("authreq_1"), event.EntityID)
				assert.Equal(t, new("user_1"), event.UserID)
				assert.Equal(t, new("sess_1"), event.SessionID)
				assert.Nil(t, event.ActorID, "the user did not act")
				assert.JSONEq(t, `{"client_id":"`+input.ClientID+`","reason":"`+tt.wantReason+`"}`, string(event.Payload))
				return
			}
			require.NoError(t, err)
			require.NoError(t, callbackErr)

			parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.EdDSA})
			require.NoError(t, err)
			require.Len(t, parsed.Signatures, 1)
			header := parsed.Signatures[0].Header
			assert.Equal(t, "at+jwt", header.ExtraHeaders[jose.HeaderType])
			assert.Equal(t, string(jose.EdDSA), header.Algorithm)
			assert.Equal(t, "sig_key_1", header.KeyID)
			payload, err := parsed.Verify(private.Public())
			require.NoError(t, err)

			var claims map[string]any
			require.NoError(t, json.Unmarshal(payload, &claims))
			now := float64(time.Now().Unix())
			assert.InDelta(t, now, claims["iat"], 5)
			if !session.ExpiresAt.IsZero() && session.ExpiresAt.Before(before.Add(domain.AccessTokenTTL)) {
				assert.Equal(t, float64(session.ExpiresAt.Unix()), claims["exp"], "the token expires with its session")
				assert.InDelta(t, 2*time.Minute, expiresIn, float64(5*time.Second))
				assert.LessOrEqual(t, expiresIn, session.ExpiresAt.Sub(before))
			} else {
				assert.Equal(t, claims["iat"].(float64)+domain.AccessTokenTTL.Seconds(), claims["exp"])
				assert.Equal(t, domain.AccessTokenTTL, expiresIn)
			}
			delete(claims, "iat")
			delete(claims, "exp")
			want := map[string]any{
				"iss":       "https://shop.example.com/oauth/proj_1",
				"sub":       "user_1",
				"aud":       []any{"shop"},
				"client_id": "shop",
				"jti":       "tkn_1",
			}
			wantPayload := `{"client_id":"shop"}`
			if len(request.Scopes) > 0 {
				want["scope"] = "read write"
				wantPayload = `{"client_id":"shop","scopes":["read","write"]}`
			}
			assert.Equal(t, want, claims, "no nbf or sid, and scope only with stored scopes")

			require.Len(t, events, 1)
			event := events[0]
			assert.Equal(t, domain.EventTypeAuthTokenIssued, event.EventType)
			assert.Equal(t, new("token"), event.EntityType)
			assert.Equal(t, new("tkn_1"), event.EntityID)
			assert.Equal(t, new("sess_1"), event.SessionID)
			assert.Equal(t, new("user_1"), event.UserID)
			assert.JSONEq(t, wantPayload, string(event.Payload))
		})
	}
}

// Without a signer the redemption stops before its transaction, so the code
// is not consumed.
func TestAuthRequestService_RedeemCodeWithoutSigner(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl) // no Transaction expected
	keys := servicemocks.NewMockKeyService(ctrl)
	signerErr := domain.ErrInternal(errors.New("boom")).WithMessage("failed to load the signing key")
	keys.EXPECT().GetProjectSigner(gomock.Any(), "proj_1", domain.SigningKeyPurposeToken, gomock.Any()).Return(nil, signerErr)

	token, expiresIn, err := service.NewAuthRequestService(service.NewPool(pool), keys).RedeemCode(t.Context(), service.RedeemCodeInput{
		ProjectID: "proj_1",
		ClientID:  "shop",
		Code:      redeemCode,
	})
	assert.Equal(t, signerErr, err)
	assert.Empty(t, token)
	assert.Zero(t, expiresIn)
}

func activeSession(userID *string) *domain.Session {
	return &domain.Session{
		ProjectID: "proj_1",
		ID:        "sess_1",
		UserID:    userID,
		ExpiresAt: time.Now().Add(time.Hour),
		Factors:   []domain.AuthFactor{&domain.AuthFactorUser{UserID: "user_1"}},
	}
}

// failingSigner fails every signature, which no real key does.
type failingSigner struct{}

func (failingSigner) Sign([]byte) (*jose.JSONWebSignature, error) {
	return nil, errors.New("sign failed")
}
func (failingSigner) Options() jose.SignerOptions { return jose.SignerOptions{} }
