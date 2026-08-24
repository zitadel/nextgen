package service_test

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"testing"
	"time"

	"go.uber.org/mock/gomock"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
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
					// NewSession clones the user agent, so compare by value, not identity.
					if !reflect.DeepEqual(gotSession.UserAgent, tt.input.UserAgent) {
						t.Fatalf("Create session.UserAgent = %+v, want %+v", gotSession.UserAgent, tt.input.UserAgent)
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
	exchangedUserID := "user-1"
	userBoundSession := &domain.Session{ProjectID: "proj", ID: "sess", UserID: &exchangedUserID}
	overrideTTL := 2 * time.Hour
	invalidZero := time.Duration(0)
	invalidAboveMax := cfg.MaxTTL + time.Second

	for _, tt := range []struct {
		name       string
		input      service.ExchangeInput
		wantTTL    time.Duration
		repoResult *domain.Session
		repoErr    error
		userResult *domain.User
		userErr    error
		want       *domain.Session
		wantErr    error
	}{
		{
			name: "mints for an active user",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
			},
			wantTTL:    cfg.DefaultTTL,
			repoResult: userBoundSession,
			userResult: &domain.User{ProjectID: "proj", ID: exchangedUserID},
			want:       userBoundSession,
		},
		{
			name: "rejects a user deactivated between verify and exchange",
			input: service.ExchangeInput{
				ProjectID:    "proj",
				HandoffToken: "handoff-token",
			},
			wantTTL:    cfg.DefaultTTL,
			repoResult: userBoundSession,
			userErr:    database.NewNoRowFoundError(nil),
			wantErr:    domain.ErrSessionInvalidHandoffToken(),
		},
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
			if tt.userResult != nil || tt.userErr != nil {
				statements.EXPECT().
					GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(_ context.Context, filter database.Filter[domain.UserField], _ service.UserQueryOptions) (*domain.User, error) {
						// The mint gate must require the active status (#553).
						assert.Equal(t, database.And(
							database.Equal(database.Col(domain.UserFieldProjectID), tt.input.ProjectID),
							database.Equal(database.Col(domain.UserFieldID), *tt.repoResult.UserID),
							database.Equal(database.Col(domain.UserFieldStatus), domain.UserStatusActive.String()),
						), filter)
						return tt.userResult, tt.userErr
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

func TestSessionService_List(t *testing.T) {
	t.Parallel()

	createdAt := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name         string
		input        service.ListSessionInput
		result       *database.ListResult[*domain.Session]
		statementErr error
		wantErr      error
		checkOpts    func(t *testing.T, opts *database.ListOptions[domain.SessionField])
		checkResp    func(t *testing.T, resp *service.ListSessionsResponse)
	}{
		{
			name:  "defaults to newest first",
			input: service.ListSessionInput{ProjectID: "proj_a"},
			result: &database.ListResult[*domain.Session]{
				Items:      []*domain.Session{{ID: "sess_b"}, {ID: "sess_a"}},
				NextCursor: []byte("next"),
			},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
				assert.Empty(t, opts.Pagination.Cursor)
				assert.Equal(t, database.OrderDesc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.SessionField]{
					database.Col(domain.SessionFieldCreatedAt),
					database.Col(domain.SessionFieldID),
				}, opts.Pagination.OrderBy.Columns)
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.SessionFieldProjectID), "proj_a"),
				), opts.Filter)
			},
			checkResp: func(t *testing.T, resp *service.ListSessionsResponse) {
				assert.Len(t, resp.Sessions, 2)
				assert.Equal(t, "next", resp.NextPageToken)
			},
		},
		{
			name:   "limit clamped to max",
			input:  service.ListSessionInput{ProjectID: "proj_a", Limit: 500},
			result: &database.ListResult[*domain.Session]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, uint32(100), opts.Pagination.Limit)
			},
		},
		{
			name:   "zero limit uses default",
			input:  service.ListSessionInput{ProjectID: "proj_a", Limit: 0},
			result: &database.ListResult[*domain.Session]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
			},
		},
		{
			name: "sort direction respected",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "asc"},
			},
			result: &database.ListResult[*domain.Session]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, database.OrderAsc, opts.Pagination.OrderBy.Direction)
			},
		},
		{
			name: "sort by user_id appends id tiebreaker",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Sorting:   &service.Sorting{Field: "user_id", Direction: "desc"},
			},
			result: &database.ListResult[*domain.Session]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, database.OrderDesc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.SessionField]{
					database.Col(domain.SessionFieldUserID),
					database.Col(domain.SessionFieldID),
				}, opts.Pagination.OrderBy.Columns)
			},
		},
		{
			name: "filter by user_id",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "user_id", Operation: "equals", Value: "usr_1"}},
			},
			result: &database.ListResult[*domain.Session]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.SessionFieldProjectID), "proj_a"),
					database.StringEqual(database.Col(domain.SessionFieldUserID), "usr_1"),
				), opts.Filter)
			},
		},
		{
			name: "filter greater_than createdAt parses RFC3339",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "created_at", Operation: "greater_than", Value: createdAt.Format(time.RFC3339)}},
			},
			result: &database.ListResult[*domain.Session]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.SessionFieldProjectID), "proj_a"),
					database.GreaterThan(database.Col(domain.SessionFieldCreatedAt), createdAt),
				), opts.Filter)
			},
		},
		{
			name:   "page token passed through as cursor",
			input:  service.ListSessionInput{ProjectID: "proj_a", PageToken: "tok"},
			result: &database.ListResult[*domain.Session]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.SessionField]) {
				assert.Equal(t, []byte("tok"), opts.Pagination.Cursor)
			},
		},
		{
			name:         "statement error is wrapped",
			input:        service.ListSessionInput{ProjectID: "proj_a"},
			statementErr: errors.New("boom"),
			wantErr:      domain.ErrInternal(nil),
		},
		{
			name:         "invalid cursor maps to request invalid",
			input:        service.ListSessionInput{ProjectID: "proj_a", PageToken: "bad"},
			statementErr: database.ErrInvalidCursor(),
			wantErr:      domain.ErrRequestInvalid(),
		},
		{
			name:         "cursor order mismatch maps to request invalid",
			input:        service.ListSessionInput{ProjectID: "proj_a", PageToken: "bad"},
			statementErr: database.ErrCursorOrderMismatch(),
			wantErr:      domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, statements := newMockedSessionService(t, &userReaderStub{}, sessionConfigForTest())

			var gotOpts *database.ListOptions[domain.SessionField]
			statements.EXPECT().ListSessions(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, opts *database.ListOptions[domain.SessionField]) (*database.ListResult[*domain.Session], error) {
					gotOpts = opts
					return tc.result, tc.statementErr
				})

			resp, err := svc.List(context.Background(), tc.input)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			if tc.checkOpts != nil {
				tc.checkOpts(t, gotOpts)
			}
			if tc.checkResp != nil {
				tc.checkResp(t, resp)
			}
		})
	}
}

func TestSessionService_List_ValidationErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   service.ListSessionInput
		wantErr error
	}{
		{
			name:    "missing project id is refused",
			input:   service.ListSessionInput{},
			wantErr: domain.ErrProjectMissingID(),
		},
		{
			name: "unknown filter field is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "token_id", Operation: "equals", Value: "x"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort field is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Sorting:   &service.Sorting{Field: "state"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort direction is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "sideways"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "missing sort direction is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Sorting:   &service.Sorting{Field: "created_at"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string user_id value is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "user_id", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "ordering operation on user_id is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "user_id", Operation: "less_than", Value: "usr_1"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unparseable createdAt value is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: "not-a-time"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown state value is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "state", Operation: "equals", Value: "revoked"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string state value is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "state", Operation: "equals", Value: 1}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "state not_equals not implemented",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "state", Operation: "not_equals", Value: "active"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "ordering operation on state is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "state", Operation: "greater_than", Value: "active"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown operation on state is invalid",
			input: service.ListSessionInput{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "state", Operation: "like", Value: "active"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			// The statement must never be reached: validation fails first, so no
			// ListSessions expectation is set and gomock would flag an unexpected call.
			svc, _ := newMockedSessionService(t, &userReaderStub{}, sessionConfigForTest())

			_, err := svc.List(context.Background(), tc.input)
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}
