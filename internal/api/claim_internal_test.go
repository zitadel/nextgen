package api

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

func TestVerifyClaimSession(t *testing.T) {
	t.Parallel()

	const platformProjectID = "proj_platform"

	sessionToken := func(projectID string) *domain.Token {
		return &domain.Token{
			ProjectID: projectID,
			TokenID:   "tkn_1",
			Type:      domain.TokenTypeSessionToken,
			SessionID: new("sess_1"),
		}
	}
	activeSession := func(projectID string) *domain.Session {
		return &domain.Session{
			ProjectID: projectID,
			ID:        "sess_1",
			TokenID:   "tkn_1",
			ExpiresAt: time.Now().Add(time.Hour),
			UserID:    new("user_1"),
			Factors:   []domain.AuthFactor{domain.SetAuthFactorUser(time.Now())},
		}
	}

	serviceFailure := domain.ErrInternal(errors.New("boom")).WithMessage("Failed to get the session.")

	tests := []struct {
		name string
		// token is stashed in the context when non-nil.
		token *domain.Token
		// session/getErr are the mocked SessionService.Get outcome; the
		// expectation is only registered when either is set, so cases rejected
		// before the lookup prove no Get happens.
		session *domain.Session
		getErr  error
		// platformProjectID overrides the handler pin when set.
		handlerProjectID *string

		wantUserID string
		// wantSentinel is the internal diagnostic expected in the chain.
		wantSentinel error
		// wantUnauthorized asserts the public 401 wrapping.
		wantUnauthorized bool
	}{
		{
			name:             "no session token in context",
			wantSentinel:     domain.ErrSessionTokenInvalid(),
			wantUnauthorized: true,
		},
		{
			name:             "session not found",
			token:            sessionToken(platformProjectID),
			getErr:           domain.ErrSessionNotFound(),
			wantSentinel:     domain.ErrSessionNotFound(),
			wantUnauthorized: true,
		},
		{
			name:         "session service failure passes through",
			token:        sessionToken(platformProjectID),
			getErr:       serviceFailure,
			wantSentinel: serviceFailure,
		},
		{
			name:  "rotated token",
			token: sessionToken(platformProjectID),
			session: func() *domain.Session {
				s := activeSession(platformProjectID)
				s.TokenID = "tkn_old"
				return s
			}(),
			wantSentinel:     domain.ErrSessionTokenInvalid(),
			wantUnauthorized: true,
		},
		{
			name:             "token of a foreign project",
			token:            sessionToken("proj_other"),
			wantSentinel:     domain.ErrClaimSessionWrongProject(),
			wantUnauthorized: true,
		},
		{
			name:             "unresolved platform project",
			token:            sessionToken(platformProjectID),
			handlerProjectID: new(""),
			wantSentinel:     domain.ErrClaimSessionWrongProject(),
			wantUnauthorized: true,
		},
		{
			name:  "expired session",
			token: sessionToken(platformProjectID),
			session: func() *domain.Session {
				s := activeSession(platformProjectID)
				s.ExpiresAt = time.Now().Add(-time.Minute)
				return s
			}(),
			wantSentinel:     domain.ErrClaimSessionExpired(),
			wantUnauthorized: true,
		},
		{
			name:  "expired session without factors reports expiry",
			token: sessionToken(platformProjectID),
			session: func() *domain.Session {
				s := activeSession(platformProjectID)
				s.ExpiresAt = time.Now().Add(-time.Minute)
				s.Factors = nil
				return s
			}(),
			wantSentinel:     domain.ErrClaimSessionExpired(),
			wantUnauthorized: true,
		},
		{
			name:  "building session",
			token: sessionToken(platformProjectID),
			session: func() *domain.Session {
				s := activeSession(platformProjectID)
				s.Factors = nil
				return s
			}(),
			wantSentinel:     domain.ErrClaimSessionNotActive(),
			wantUnauthorized: true,
		},
		{
			name:  "active session without user",
			token: sessionToken(platformProjectID),
			session: func() *domain.Session {
				s := activeSession(platformProjectID)
				s.UserID = nil
				return s
			}(),
			wantSentinel:     domain.ErrClaimSessionNotActive(),
			wantUnauthorized: true,
		},
		{
			name:       "active platform session",
			token:      sessionToken(platformProjectID),
			session:    activeSession(platformProjectID),
			wantUserID: "user_1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			svc := mocks.NewMockSessionService(gomock.NewController(t))
			ctx := t.Context()
			if tt.token != nil {
				ctx = context.WithValue(ctx, sessionTokenKey{}, tt.token)
			}
			if tt.session != nil || tt.getErr != nil {
				svc.EXPECT().
					Get(gomock.Any(), service.GetSessionInput{
						ProjectID: tt.token.ProjectID,
						SessionID: "sess_1",
					}).
					Return(tt.session, tt.getErr)
			}

			handler := Handler{sessionService: svc, platformProjectID: platformProjectID}
			if tt.handlerProjectID != nil {
				handler.platformProjectID = *tt.handlerProjectID
			}

			userID, err := handler.verifyClaimSession(ctx)

			if tt.wantSentinel == nil {
				require.NoError(t, err)
				require.Equal(t, tt.wantUserID, userID)
				return
			}

			require.Empty(t, userID)
			require.ErrorIs(t, err, tt.wantSentinel)

			var domainErr domain.Error
			require.ErrorAs(t, err, &domainErr)
			if !tt.wantUnauthorized {
				require.NotEqual(t, "auth.unauthorized", domainErr.Code)
				return
			}
			require.Equal(t, "auth.unauthorized", domainErr.Code)
			require.Equal(t, sessionUnauthorizedMessage, domainErr.Message)
		})
	}
}

func TestSessionCookieOperationsIncludeCompleteClaim(t *testing.T) {
	t.Parallel()

	require.True(t, sessionCookieOperations[api.CompleteClaimOperation])
}

// Every public claim error code must map to its documented HTTP status
// (mirrors TestProjectErrorResponse; the proj.* claim codes are covered there).
func TestClaimErrorResponse(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  domain.Error
		want int
	}{
		{"challenge_not_found", domain.ErrClaimChallengeNotFound(), http.StatusNotFound},
		{"challenge_invalid", domain.ErrClaimChallengeInvalid(), http.StatusBadRequest},
		{"no_personal_team", domain.ErrClaimNoPersonalTeam(), http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := claimErrorResponse(tt.err); got.StatusCode != tt.want {
				t.Fatalf("claimErrorResponse(%q) status = %d, want %d", tt.err.Code, got.StatusCode, tt.want)
			}
		})
	}
}

func TestAlreadyClaimedResponse(t *testing.T) {
	t.Parallel()

	conflict := domain.ErrProjectAlreadyClaimed().WithDetails(domain.ClaimConflictDetails{
		TeamID:       "team_1",
		DashboardURL: "https://console.invalid/ui/console/projects/proj_1",
	})

	resp, ok := alreadyClaimedResponse(conflict)
	require.True(t, ok)
	require.Equal(t, domain.ErrProjectAlreadyClaimed().Code, resp.Code)
	require.Equal(t, api.TeamID("team_1"), resp.Details.TeamID)
	require.Equal(t, "https://console.invalid/ui/console/projects/proj_1", resp.Details.DashboardURL.String())

	_, ok = alreadyClaimedResponse(domain.ErrProjectClaimExpired())
	require.False(t, ok, "wrong code must fall back to the generic envelope")

	_, ok = alreadyClaimedResponse(domain.ErrProjectAlreadyClaimed())
	require.False(t, ok, "conflict without details must fall back to the generic envelope")
}
