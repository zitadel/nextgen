package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type sessionRepoStub struct {
	createFunc   func(context.Context, database.QueryExecutor, *domain.Session) error
	exchangeFunc func(context.Context, database.QueryExecutor, string, string, *string, time.Duration) (*domain.Session, error)
	getFunc      func(context.Context, database.QueryExecutor, string, string) (*domain.Session, error)
}

func (s *sessionRepoStub) Create(ctx context.Context, q database.QueryExecutor, session *domain.Session) error {
	if s.createFunc == nil {
		panic("unexpected Create call")
	}
	return s.createFunc(ctx, q, session)
}

func (s *sessionRepoStub) Exchange(ctx context.Context, q database.QueryExecutor, projectID, handoffToken string, idempotencyKey *string, ttl time.Duration) (*domain.Session, error) {
	if s.exchangeFunc == nil {
		panic("unexpected Exchange call")
	}
	return s.exchangeFunc(ctx, q, projectID, handoffToken, idempotencyKey, ttl)
}

func (s *sessionRepoStub) Get(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	if s.getFunc == nil {
		panic("unexpected Get call")
	}
	return s.getFunc(ctx, q, projectID, sessionID)
}

func (s *sessionRepoStub) List(context.Context, database.QueryExecutor, string) ([]*domain.Session, error) {
	panic("unexpected List call")
}

func (s *sessionRepoStub) Delete(context.Context, database.QueryExecutor, string, string) error {
	panic("unexpected Delete call")
}

func sessionConfigForTest() service.SessionConfig {
	return service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour}
}

func TestSessionService_Create(t *testing.T) {
	userAgent := &domain.UserAgent{
		ID: "ua-1",
		IP: "192.0.2.1",
		Info: map[string]any{
			"user_agent": "test",
		},
	}
	createdSession := &domain.Session{ProjectID: "proj", ID: "sess"}

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
			repo := &sessionRepoStub{
				createFunc: func(_ context.Context, q database.QueryExecutor, gotSession *domain.Session) error {
					if q != stubPool() {
						t.Fatalf("Create q = %v, want service pool", q)
					}
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
				},
			}

			got, err := service.NewSessionService(stubPool(), repo, sessionConfigForTest()).Create(t.Context(), tt.input)
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
			repo := &sessionRepoStub{
				exchangeFunc: func(_ context.Context, q database.QueryExecutor, projectID, handoffToken string, gotIdempotencyKey *string, gotTTL time.Duration) (*domain.Session, error) {
					if q != stubPool() {
						t.Fatalf("Exchange q = %v, want service pool", q)
					}
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
				},
			}

			got, err := service.NewSessionService(stubPool(), repo, cfg).Exchange(t.Context(), tt.input)
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
			repo := &sessionRepoStub{
				getFunc: func(_ context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
					if q != stubPool() {
						t.Fatalf("Get q = %v, want service pool", q)
					}
					if projectID != tt.input.ProjectID {
						t.Fatalf("Get projectID = %q, want %q", projectID, tt.input.ProjectID)
					}
					if sessionID != tt.input.SessionID {
						t.Fatalf("Get sessionID = %q, want %q", sessionID, tt.input.SessionID)
					}
					return tt.repoResult, tt.repoErr
				},
			}

			got, err := service.NewSessionService(stubPool(), repo, sessionConfigForTest()).Get(t.Context(), tt.input)
			assertSessionResult(t, "Get", got, err, tt.want, tt.wantErr)
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
