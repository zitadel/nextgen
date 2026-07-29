package service_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// userReaderStub implements service.UserIdentityReader and records the
// identity lookup inputs so tests can assert which user was hydrated.
type userReaderStub struct {
	getFunc          func(context.Context, string, string, ...string) (*domain.User, error)
	gotProjectID     string
	gotUserID        string
	gotAttributeKeys []string
}

func (s *userReaderStub) GetIdentity(ctx context.Context, projectID, userID string, attributeKeys ...string) (*domain.User, error) {
	s.gotProjectID, s.gotUserID = projectID, userID
	s.gotAttributeKeys = attributeKeys
	if s.getFunc == nil {
		panic("unexpected users.GetIdentity call")
	}
	return s.getFunc(ctx, projectID, userID, attributeKeys...)
}

func sessionConfigForTest() service.SessionConfig {
	return service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour}
}

func newMockedSessionService(t *testing.T, users service.UserIdentityReader, cfg service.SessionConfig) (service.SessionService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewSessionService(pool, users, cfg), statements
}

func TestSessionService_Create(t *testing.T) {
	userAgent := &domain.UserAgent{
		ID: "ua-1",
		IP: "192.0.2.1",
		Info: map[string]any{
			"user_agent": "test",
		},
	}
	createdSession := &domain.Session{ID: "sess"}

	for _, tt := range []struct {
		name    string
		input   service.CreateSessionInput
		repoErr error
		wantID  string
		wantErr error
	}{
		{
			name: "returns created session",
			input: service.CreateSessionInput{
				ProjectID: "proj",
				UserAgent: userAgent,
			},
			wantID: createdSession.ID,
		},
		{
			name: "wraps repository error",
			input: service.CreateSessionInput{
				ProjectID: "proj",
			},
			repoErr: errors.New("boom"),
			wantErr: domain.ErrInternal(nil),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc, statements := newMockedSessionService(t, &userReaderStub{}, sessionConfigForTest())
			statements.EXPECT().
				CreateSession(gomock.Any(), gomock.Any()).
				DoAndReturn(func(_ context.Context, gotSession *domain.Session) error {
					if gotSession.ProjectID != tt.input.ProjectID {
						t.Fatalf("Create session.ProjectID = %q, want %q", gotSession.ProjectID, tt.input.ProjectID)
					}
					if gotSession.UserAgent != tt.input.UserAgent {
						t.Fatalf("Create session.UserAgent = %p, want %p", gotSession.UserAgent, tt.input.UserAgent)
					}
					if gotSession.TimeToLive != domain.SessionAnonymousTTL {
						t.Fatalf("Create session.TimeToLive = %v, want %v", gotSession.TimeToLive, domain.SessionAnonymousTTL)
					}
					gotSession.ID = tt.wantID
					return tt.repoErr
				})

			got, err := svc.Create(t.Context(), tt.input)
			if tt.wantErr != nil {
				assertSessionResult(t, "Create", got, err, nil, tt.wantErr)
				return
			}
			if err != nil {
				t.Fatalf("Create returned error: %v", err)
			}
			if got == nil {
				t.Fatalf("Create returned nil session")
			}
			if got.ID != tt.wantID {
				t.Fatalf("Create session.ID = %q, want %q", got.ID, tt.wantID)
			}
		})
	}
}

func TestSessionService_Exchange(t *testing.T) {
	cfg := sessionConfigForTest()
	idempotencyKey := "retry-1"
	exchangedSession := &domain.Session{ProjectID: "proj", ID: "sess"}
	overrideTTL := 2 * time.Hour
	invalidZero := time.Duration(0)
	invalidAboveMax := cfg.MaxTTL + time.Second

	for _, tt := range []struct {
		name       string
		input      service.ExchangeInput
		wantTTL    time.Duration
		repoResult *domain.Session
		repoErr    error
		want       *domain.Session
		wantErr    error
	}{
		{
			name: "returns exchanged session with default ttl",
			input: service.ExchangeInput{
				ProjectID:      "proj",
				HandoffToken:   "handoff-token",
				IdempotencyKey: &idempotencyKey,
			},
			wantTTL:    cfg.DefaultTTL,
			repoResult: exchangedSession,
			want:       exchangedSession,
		},
		{
			name: "passes explicit ttl",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
				TTL:          &overrideTTL,
			},
			wantTTL:    overrideTTL,
			repoResult: exchangedSession,
			want:       exchangedSession,
		},
		{
			name: "rejects zero ttl",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
				TTL:          &invalidZero,
			},
			wantErr: domain.ErrSessionInvalidTTL(),
		},
		{
			name: "rejects ttl above max",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
				TTL:          &invalidAboveMax,
			},
			wantErr: domain.ErrSessionInvalidTTL(),
		},
		{
			name: "passes through invalid handoff token",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
			},
			repoErr: domain.ErrSessionInvalidHandoffToken(),
			wantErr: domain.ErrSessionInvalidHandoffToken(),
		},
		{
			name: "passes through exchange conflict",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
			},
			repoErr: domain.ErrSessionExchangeConflict(),
			wantErr: domain.ErrSessionExchangeConflict(),
		},
		{
			name: "wraps unexpected repository error",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
			},
			repoErr: errors.New("boom"),
			wantErr: domain.ErrInternal(nil),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc, statements := newMockedSessionService(t, &userReaderStub{}, cfg)
			if tt.repoResult != nil || tt.repoErr != nil {
				statements.EXPECT().
					ExchangeSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(_ context.Context, projectID, handoffToken string, gotIdempotencyKey *string, gotTTL time.Duration) (*domain.Session, error) {
						if projectID != tt.input.ProjectID {
							t.Fatalf("Exchange projectID = %q, want %q", projectID, tt.input.ProjectID)
						}
						if handoffToken != tt.input.HandoffToken {
							t.Fatalf("Exchange handoffToken = %q, want %q", handoffToken, tt.input.HandoffToken)
						}
						if gotIdempotencyKey != tt.input.IdempotencyKey {
							t.Fatalf("Exchange idempotencyKey = %p, want %p", gotIdempotencyKey, tt.input.IdempotencyKey)
						}
						if tt.wantErr == nil && gotTTL != tt.wantTTL {
							t.Fatalf("Exchange ttl = %v, want %v", gotTTL, tt.wantTTL)
						}
						return tt.repoResult, tt.repoErr
					})
			}

			got, err := svc.Exchange(t.Context(), tt.input)
			assertSessionResult(t, "Exchange", got, err, tt.want, tt.wantErr)
		})
	}
}

func TestSessionService_Get(t *testing.T) {
	foundSession := &domain.Session{ProjectID: "proj", ID: "sess"}

	for _, tt := range []struct {
		name       string
		input      service.GetSessionInput
		repoResult *domain.Session
		repoErr    error
		want       *domain.Session
		wantErr    error
	}{
		{
			name: "returns session",
			input: service.GetSessionInput{
				ProjectID: "proj",
				SessionID: "sess",
			},
			repoResult: foundSession,
			want:       foundSession,
		},
		{
			name: "passes through not found",
			input: service.GetSessionInput{
				ProjectID: "proj",
				SessionID: "sess",
			},
			repoErr: domain.ErrSessionNotFound(),
			wantErr: domain.ErrSessionNotFound(),
		},
		{
			name: "wraps unexpected repository error",
			input: service.GetSessionInput{
				ProjectID: "proj",
				SessionID: "sess",
			},
			repoErr: errors.New("boom"),
			wantErr: domain.ErrInternal(nil),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc, statements := newMockedSessionService(t, &userReaderStub{}, sessionConfigForTest())
			statements.EXPECT().
				GetSessionByID(gomock.Any(), gomock.Any(), gomock.Any()).
				DoAndReturn(func(_ context.Context, projectID, sessionID string) (*domain.Session, error) {
					if projectID != tt.input.ProjectID {
						t.Fatalf("Get projectID = %q, want %q", projectID, tt.input.ProjectID)
					}
					if sessionID != tt.input.SessionID {
						t.Fatalf("Get sessionID = %q, want %q", sessionID, tt.input.SessionID)
					}
					return tt.repoResult, tt.repoErr
				})

			got, err := svc.Get(t.Context(), tt.input)
			assertSessionResult(t, "Get", got, err, tt.want, tt.wantErr)
		})
	}
}

func TestSessionService_Get_UserIdentity(t *testing.T) {
	userID := "user-1"
	identityUser := &domain.User{
		ProjectID: "proj",
		ID:        userID,
		Attributes: []domain.Attribute{
			{Key: "email", Value: "ada@example.com"},
			{Key: "given_name", Value: "Ada"},
		},
	}

	for _, tt := range []struct {
		name          string
		sessionUserID *string
		userResult    *domain.User
		userErr       error
		wantUser      *domain.User
		wantErr       error
	}{
		{
			name:          "hydrates the linked user",
			sessionUserID: &userID,
			userResult:    identityUser,
			wantUser:      identityUser,
		},
		{
			name:          "skips anonymous sessions",
			sessionUserID: nil,
		},
		{
			name:          "tolerates a session that outlived its user",
			sessionUserID: &userID,
			userErr:       database.NewNoRowFoundError(nil),
		},
		{
			name:          "wraps unexpected user lookup error",
			sessionUserID: &userID,
			userErr:       errors.New("boom"),
			wantErr:       domain.ErrInternal(nil),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			users := &userReaderStub{}
			if tt.sessionUserID != nil {
				users.getFunc = func(_ context.Context, projectID, uid string, keys ...string) (*domain.User, error) {
					return tt.userResult, tt.userErr
				}
			}

			svc, statements := newMockedSessionService(t, users, sessionConfigForTest())
			statements.EXPECT().
				GetSessionByID(gomock.Any(), gomock.Any(), gomock.Any()).
				Return(&domain.Session{ProjectID: "proj", ID: "sess", UserID: tt.sessionUserID}, nil)

			input := service.GetSessionInput{ProjectID: "proj", SessionID: "sess", WithUserIdentity: true}
			got, err := svc.Get(t.Context(), input)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("Get err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Get returned error: %v", err)
			}
			if got.User != tt.wantUser {
				t.Fatalf("Get session.User = %v, want %v", got.User, tt.wantUser)
			}
			if tt.sessionUserID == nil {
				return
			}
			if users.gotProjectID != "proj" || users.gotUserID != userID {
				t.Fatalf("users queried with (%q, %q), want (%q, %q)", users.gotProjectID, users.gotUserID, "proj", userID)
			}
			if !slices.Equal(users.gotAttributeKeys, domain.IdentityAttributeKeys) {
				t.Fatalf("users.GetIdentity keys = %v, want %v", users.gotAttributeKeys, domain.IdentityAttributeKeys)
			}
		})
	}
}

func assertSessionResult(t *testing.T, operation string, got *domain.Session, err error, want *domain.Session, wantErr error) {
	t.Helper()

	if wantErr != nil {
		if !errors.Is(err, wantErr) {
			t.Fatalf("%s err = %v, want %v", operation, err, wantErr)
		}
		if got != nil {
			t.Fatalf("%s = %v, want nil on error", operation, got)
		}
		return
	}

	if err != nil {
		t.Fatalf("%s returned error: %v", operation, err)
	}
	if got != want {
		t.Fatalf("%s = %v, want %v", operation, got, want)
	}
}
