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

type fakeAuthAttemptRepo struct {
	getByIDAttempt *domain.AuthAttempt
	getByIDErr     error

	createErr      error
	createdAttempt *domain.AuthAttempt

	setChallengeErr      error
	setChallengeProject  string
	setChallengeAttempt  string
	setChallengeValue    domain.AuthChallenge
	challengeFailedErr   error
	challengeFailedValue domain.AuthChallenge
	challengeFailedCalls int

	challengeSucceededErr       error
	challengeSucceededFactor    domain.AuthFactor
	challengeSucceededChallenge string

	handoffErr     error
	handoffAttempt *domain.AuthAttempt
}

func (f *fakeAuthAttemptRepo) GetByID(_ context.Context, _ database.QueryExecutor, _, _ string) (*domain.AuthAttempt, error) {
	if f.getByIDErr != nil {
		return nil, f.getByIDErr
	}
	return f.getByIDAttempt, nil
}

func (f *fakeAuthAttemptRepo) GetByHandoffToken(_ context.Context, _ database.QueryExecutor, _ string, _ []byte) (*domain.AuthAttempt, error) {
	panic("GetByHandoffToken not expected in service tests")
}

func (f *fakeAuthAttemptRepo) Create(_ context.Context, _ database.QueryExecutor, attempt *domain.AuthAttempt) error {
	f.createdAttempt = attempt
	return f.createErr
}

func (f *fakeAuthAttemptRepo) Delete(_ context.Context, _ database.QueryExecutor, _, _ string) error {
	panic("Delete not expected in service tests")
}

func (f *fakeAuthAttemptRepo) Handoff(_ context.Context, _ database.QueryExecutor, attempt *domain.AuthAttempt) error {
	f.handoffAttempt = attempt
	return f.handoffErr
}

func (f *fakeAuthAttemptRepo) SetChallenge(_ context.Context, _ database.QueryExecutor, projectID, authAttemptID string, challenge domain.AuthChallenge) error {
	f.setChallengeProject = projectID
	f.setChallengeAttempt = authAttemptID
	f.setChallengeValue = challenge
	return f.setChallengeErr
}

func (f *fakeAuthAttemptRepo) ChallengeSucceeded(_ context.Context, _ database.QueryExecutor, _, _ string, factor domain.AuthFactor, challengeID string) error {
	f.challengeSucceededFactor = factor
	f.challengeSucceededChallenge = challengeID
	return f.challengeSucceededErr
}

func (f *fakeAuthAttemptRepo) ChallengeFailed(_ context.Context, _ database.QueryExecutor, _, _ string, challenge domain.AuthChallenge) error {
	f.challengeFailedCalls++
	f.challengeFailedValue = challenge
	return f.challengeFailedErr
}

type fakeSessionResolver struct {
	session *domain.Session
	err     error
	calls   int
}

func (f *fakeSessionResolver) GetByID(_ context.Context, _ database.QueryExecutor, _, _ string) (*domain.Session, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.session, nil
}

type fakeUserLookup struct {
	user *domain.User
	err  error
}

func (f *fakeUserLookup) Get(_ context.Context, _ database.QueryExecutor, _ ...database.QueryOption) (*domain.User, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.user, nil
}

func (f *fakeUserLookup) ProjectIDCondition(_ string) database.Condition { return nil }
func (f *fakeUserLookup) IDCondition(_ string) database.Condition        { return nil }
func (f *fakeUserLookup) AttributesCondition(_ []domain.Attribute) database.Condition {
	return nil
}

func TestAuthAttemptService_Create(t *testing.T) {
	sessionID := "sess-1"
	createErr := errors.New("create failed")
	unexpectedSessionErr := errors.New("session lookup failed")

	tests := []struct {
		name   string
		input  service.CreateAuthAttemptInput
		repo   *fakeAuthAttemptRepo
		sess   *fakeSessionResolver
		assert func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo, sess *fakeSessionResolver)
	}{
		{
			name:  "creates attempt without session",
			input: service.CreateAuthAttemptInput{ProjectID: "proj", RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser}},
			repo:  &fakeAuthAttemptRepo{},
			sess:  &fakeSessionResolver{},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo, sess *fakeSessionResolver) {
				t.Helper()
				if err != nil {
					t.Fatalf("Create returned error: %v", err)
				}
				if got == nil {
					t.Fatal("Create returned nil attempt")
				}
				if repo.createdAttempt != got {
					t.Fatal("Create must persist and return the same attempt instance")
				}
				if sess.calls != 0 {
					t.Fatalf("session resolver called %d times, want 0", sess.calls)
				}
			},
		},
		{
			name: "copies session factors for step-up",
			input: service.CreateAuthAttemptInput{
				ProjectID:      "proj",
				SessionID:      &sessionID,
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			},
			repo: &fakeAuthAttemptRepo{},
			sess: &fakeSessionResolver{session: &domain.Session{Factors: []domain.AuthFactor{&domain.AuthFactorUser{UserID: "user-1"}}}},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, _ *fakeAuthAttemptRepo, sess *fakeSessionResolver) {
				t.Helper()
				if err != nil {
					t.Fatalf("Create returned error: %v", err)
				}
				if sess.calls != 1 {
					t.Fatalf("session resolver called %d times, want 1", sess.calls)
				}
				if got.SessionID == nil || *got.SessionID != sessionID {
					t.Fatalf("SessionID = %v, want %q", got.SessionID, sessionID)
				}
				if _, ok := got.FactorByType(domain.AuthCheckTypeUser); !ok {
					t.Fatal("expected copied user factor from session")
				}
			},
		},
		{
			name: "maps session not found to invalid request",
			input: service.CreateAuthAttemptInput{
				ProjectID:      "proj",
				SessionID:      &sessionID,
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			},
			repo: &fakeAuthAttemptRepo{},
			sess: &fakeSessionResolver{err: domain.ErrSessionNotFound()},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo, _ *fakeSessionResolver) {
				t.Helper()
				if got != nil {
					t.Fatalf("Create returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrAuthAttemptInvalidRequest()) {
					t.Fatalf("Create err = %v, want ErrAuthAttemptInvalidRequest", err)
				}
				if repo.createdAttempt != nil {
					t.Fatal("Create must not persist attempt when session lookup fails")
				}
			},
		},
		{
			name:  "maps create repository failure to internal error",
			input: service.CreateAuthAttemptInput{ProjectID: "proj", RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser}},
			repo:  &fakeAuthAttemptRepo{createErr: createErr},
			sess:  &fakeSessionResolver{},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, _ *fakeAuthAttemptRepo, _ *fakeSessionResolver) {
				t.Helper()
				if got != nil {
					t.Fatalf("Create returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrInternal(nil)) {
					t.Fatalf("Create err = %v, want ErrInternal", err)
				}
			},
		},
		{
			name: "maps unexpected session error to internal",
			input: service.CreateAuthAttemptInput{
				ProjectID:      "proj",
				SessionID:      &sessionID,
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			},
			repo: &fakeAuthAttemptRepo{},
			sess: &fakeSessionResolver{err: unexpectedSessionErr},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo, _ *fakeSessionResolver) {
				t.Helper()
				if got != nil {
					t.Fatalf("Create returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrInternal(nil)) {
					t.Fatalf("Create err = %v, want ErrInternal", err)
				}
				if repo.createdAttempt != nil {
					t.Fatal("Create must not persist attempt when session lookup fails")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewAuthAttemptService(nil, tt.repo, tt.sess, nil, nil, nil, nil, nil)
			got, err := svc.Create(t.Context(), tt.input)
			tt.assert(t, got, err, tt.repo, tt.sess)
		})
	}
}

func TestAuthAttemptService_GetByID(t *testing.T) {
	attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
	repoErr := errors.New("repo get failed")

	tests := []struct {
		name   string
		repo   *fakeAuthAttemptRepo
		assert func(t *testing.T, got *domain.AuthAttempt, err error)
	}{
		{
			name: "returns repository attempt",
			repo: &fakeAuthAttemptRepo{getByIDAttempt: attempt},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error) {
				t.Helper()
				if err != nil {
					t.Fatalf("GetByID returned error: %v", err)
				}
				if got != attempt {
					t.Fatalf("GetByID = %v, want %v", got, attempt)
				}
			},
		},
		{
			name: "propagates repository auth attempt not found error",
			repo: &fakeAuthAttemptRepo{getByIDErr: domain.ErrAuthAttemptNotFound()},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error) {
				t.Helper()
				if got != nil {
					t.Fatalf("GetByID returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrAuthAttemptNotFound()) {
					t.Fatalf("GetByID err = %v, want %v", err, repoErr)
				}
			},
		},
		{
			name: "maps repository error to internal error",
			repo: &fakeAuthAttemptRepo{getByIDErr: repoErr},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error) {
				t.Helper()
				if got != nil {
					t.Fatalf("GetByID returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrInternal(repoErr)) {
					t.Fatalf("GetByID err = %v, want %v", err, repoErr)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewAuthAttemptService(nil, tt.repo, nil, nil, nil, nil, nil, nil)
			got, err := svc.GetByID(t.Context(), "proj", "att-1")
			tt.assert(t, got, err)
		})
	}
}

type unsupportedChallenge struct{}

func (unsupportedChallenge) ChallengeCheckType() domain.AuthCheckType {
	return domain.AuthCheckTypeUnspecified
}

func TestAuthAttemptService_IssueChallenge(t *testing.T) {
	repoErr := errors.New("set challenge failed")

	tests := []struct {
		name    string
		attempt *domain.AuthAttempt
		input   service.IssueChallengeInput
		repo    *fakeAuthAttemptRepo
		assert  func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo)
	}{
		{
			name: "issues user challenge",
			attempt: &domain.AuthAttempt{
				ProjectID: "proj",
				ID:        "att-1",
			},
			input: service.IssueChallengeInput{ProjectID: "proj", AttemptID: "att-1", Challenge: service.UserChallenge{}},
			repo:  &fakeAuthAttemptRepo{},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if err != nil {
					t.Fatalf("IssueChallenge returned error: %v", err)
				}
				if got == nil {
					t.Fatal("IssueChallenge returned nil attempt")
				}
				if _, ok := repo.setChallengeValue.(*domain.AuthChallengeUser); !ok {
					t.Fatalf("SetChallenge check type = %T, want *domain.AuthChallengeUser", repo.setChallengeValue)
				}
			},
		},
		{
			name: "issues password challenge when user factor exists",
			attempt: &domain.AuthAttempt{
				ProjectID: "proj",
				ID:        "att-1",
				Checks:    []domain.AuthCheck{&domain.AuthFactorUser{UserID: "user-1"}},
			},
			input: service.IssueChallengeInput{ProjectID: "proj", AttemptID: "att-1", Challenge: service.PasswordChallenge{}},
			repo:  &fakeAuthAttemptRepo{},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if err != nil {
					t.Fatalf("IssueChallenge returned error: %v", err)
				}
				if _, ok := repo.setChallengeValue.(*domain.AuthChallengePassword); !ok {
					t.Fatalf("SetChallenge check type = %T, want *domain.AuthChallengePassword", repo.setChallengeValue)
				}
				if got != repo.getByIDAttempt {
					t.Fatal("IssueChallenge must return loaded attempt")
				}
			},
		},
		{
			name: "returns invalid request for unsupported challenge type",
			attempt: &domain.AuthAttempt{
				ProjectID: "proj",
				ID:        "att-1",
			},
			input: service.IssueChallengeInput{ProjectID: "proj", AttemptID: "att-1", Challenge: unsupportedChallenge{}},
			repo:  &fakeAuthAttemptRepo{},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if got != nil {
					t.Fatalf("IssueChallenge returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrAuthAttemptInvalidRequest()) {
					t.Fatalf("IssueChallenge err = %v, want ErrAuthAttemptInvalidRequest", err)
				}
				if repo.setChallengeValue != nil {
					t.Fatal("SetChallenge must not be called for unsupported challenge type")
				}
			},
		},
		{
			name: "propagates set challenge error",
			attempt: &domain.AuthAttempt{
				ProjectID: "proj",
				ID:        "att-1",
			},
			input: service.IssueChallengeInput{ProjectID: "proj", AttemptID: "att-1", Challenge: service.UserChallenge{}},
			repo:  &fakeAuthAttemptRepo{setChallengeErr: repoErr},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, _ *fakeAuthAttemptRepo) {
				t.Helper()
				if got != nil {
					t.Fatalf("IssueChallenge returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, repoErr) {
					t.Fatalf("IssueChallenge err = %v, want %v", err, repoErr)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.repo.getByIDAttempt = tt.attempt
			svc := service.NewAuthAttemptService(nil, tt.repo, nil, nil, nil, nil, nil, nil)
			got, err := svc.IssueChallenge(t.Context(), tt.input)
			tt.assert(t, got, err, tt.repo)
		})
	}
}

func TestAuthAttemptService_VerifyProof(t *testing.T) {
	rejectErr := errors.New("user not found")
	succeedErr := errors.New("persist succeeded check failed")

	newUserChallengeAttempt := func() *domain.AuthAttempt {
		challenge := domain.SetAuthChallengeUser("ch-1", time.Now(), time.Time{}, 0)
		return &domain.AuthAttempt{
			ProjectID: "proj",
			ID:        "att-1",
			Checks:    []domain.AuthCheck{challenge},
		}
	}

	tests := []struct {
		name   string
		repo   *fakeAuthAttemptRepo
		users  *fakeUserLookup
		input  service.VerifyProofInput
		assert func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo)
	}{
		{
			name:  "verifies user proof and persists success",
			repo:  &fakeAuthAttemptRepo{getByIDAttempt: newUserChallengeAttempt()},
			users: &fakeUserLookup{user: &domain.User{ID: "user-1"}},
			input: service.VerifyProofInput{ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: service.UserProof{AttributeName: "email", LoginName: "u@example.com"}},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if err != nil {
					t.Fatalf("VerifyProof returned error: %v", err)
				}
				if got == nil {
					t.Fatal("VerifyProof returned nil attempt")
				}
				if repo.challengeSucceededFactor == nil {
					t.Fatal("ChallengeSucceeded was not called")
				}
				userFactor, ok := repo.challengeSucceededFactor.(*domain.AuthFactorUser)
				if !ok {
					t.Fatalf("ChallengeSucceeded factor type = %T, want *domain.AuthFactorUser", repo.challengeSucceededFactor)
				}
				if userFactor.UserID != "user-1" {
					t.Fatalf("UserID = %q, want %q", userFactor.UserID, "user-1")
				}
				if repo.challengeSucceededChallenge != "ch-1" {
					t.Fatalf("ChallengeSucceeded challengeID = %q, want %q", repo.challengeSucceededChallenge, "ch-1")
				}
				if repo.challengeFailedCalls != 0 {
					t.Fatalf("ChallengeFailed called %d times, want 0", repo.challengeFailedCalls)
				}
			},
		},
		{
			name:  "stale challenge returns error and records failure",
			repo:  &fakeAuthAttemptRepo{getByIDAttempt: newUserChallengeAttempt()},
			users: &fakeUserLookup{user: &domain.User{ID: "user-1"}},
			input: service.VerifyProofInput{ProjectID: "proj", AttemptID: "att-1", ChallengeID: "different", Proof: service.UserProof{AttributeName: "email", LoginName: "u@example.com"}},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if got != nil {
					t.Fatalf("VerifyProof returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrAuthAttemptStaleChallenge()) {
					t.Fatalf("VerifyProof err = %v, want ErrAuthAttemptStaleChallenge", err)
				}
				if repo.challengeFailedCalls != 1 {
					t.Fatalf("ChallengeFailed called %d times, want 1", repo.challengeFailedCalls)
				}
				if repo.challengeFailedValue != nil {
					t.Fatalf("ChallengeFailed challenge = %v, want nil for stale challenge", repo.challengeFailedValue)
				}
			},
		},
		{
			name:  "user lookup rejection returns proof rejected and records failure",
			repo:  &fakeAuthAttemptRepo{getByIDAttempt: newUserChallengeAttempt()},
			users: &fakeUserLookup{err: rejectErr},
			input: service.VerifyProofInput{ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: service.UserProof{AttributeName: "email", LoginName: "u@example.com"}},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if got != nil {
					t.Fatalf("VerifyProof returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrAuthAttemptProofRejected(rejectErr)) {
					t.Fatalf("VerifyProof err = %v, want ErrAuthAttemptProofRejected", err)
				}
				if repo.challengeFailedCalls != 1 {
					t.Fatalf("ChallengeFailed called %d times, want 1", repo.challengeFailedCalls)
				}
				if repo.challengeFailedValue != nil {
					t.Fatalf("ChallengeFailed challenge = %v, want nil for rejected proof", repo.challengeFailedValue)
				}
			},
		},
		{
			name:  "propagates challenge succeeded persistence error",
			repo:  &fakeAuthAttemptRepo{getByIDAttempt: newUserChallengeAttempt(), challengeSucceededErr: succeedErr},
			users: &fakeUserLookup{user: &domain.User{ID: "user-1"}},
			input: service.VerifyProofInput{ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: service.UserProof{AttributeName: "email", LoginName: "u@example.com"}},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if got != nil {
					t.Fatalf("VerifyProof returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, succeedErr) {
					t.Fatalf("VerifyProof err = %v, want %v", err, succeedErr)
				}
				if repo.challengeFailedCalls != 0 {
					t.Fatalf("ChallengeFailed called %d times, want 0", repo.challengeFailedCalls)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewAuthAttemptService(nil, tt.repo, nil, nil, tt.users, nil, nil, nil)
			got, err := svc.VerifyProof(t.Context(), tt.input)
			tt.assert(t, got, err, tt.repo)
		})
	}
}

func TestAuthAttemptService_Handoff(t *testing.T) {
	repoErr := errors.New("handoff persist failed")

	completedAttempt := func() *domain.AuthAttempt {
		return &domain.AuthAttempt{
			ProjectID:      "proj",
			ID:             "att-1",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
		}
	}

	tests := []struct {
		name   string
		repo   *fakeAuthAttemptRepo
		input  service.HandoffInput
		assert func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo)
	}{
		{
			name:  "creates and persists handoff for completed attempt",
			repo:  &fakeAuthAttemptRepo{getByIDAttempt: completedAttempt()},
			input: service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if err != nil {
					t.Fatalf("Handoff returned error: %v", err)
				}
				if got == nil {
					t.Fatal("Handoff returned nil attempt")
				}
				if got.HandoffToken == nil {
					t.Fatal("HandoffToken must be generated")
				}
				if repo.handoffAttempt != got {
					t.Fatal("Handoff must persist the mutated attempt")
				}
			},
		},
		{
			name: "returns not completed when required factors are missing",
			repo: &fakeAuthAttemptRepo{getByIDAttempt: &domain.AuthAttempt{
				ProjectID:      "proj",
				ID:             "att-1",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			}},
			input: service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, repo *fakeAuthAttemptRepo) {
				t.Helper()
				if got != nil {
					t.Fatalf("Handoff returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, domain.ErrAuthAttemptNotCompleted()) {
					t.Fatalf("Handoff err = %v, want ErrAuthAttemptNotCompleted", err)
				}
				if repo.handoffAttempt != nil {
					t.Fatal("repo.Handoff must not be called on invalid state")
				}
			},
		},
		{
			name:  "propagates repository handoff failure",
			repo:  &fakeAuthAttemptRepo{getByIDAttempt: completedAttempt(), handoffErr: repoErr},
			input: service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"},
			assert: func(t *testing.T, got *domain.AuthAttempt, err error, _ *fakeAuthAttemptRepo) {
				t.Helper()
				if got != nil {
					t.Fatalf("Handoff returned attempt = %v, want nil", got)
				}
				if !errors.Is(err, repoErr) {
					t.Fatalf("Handoff err = %v, want %v", err, repoErr)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewAuthAttemptService(nil, tt.repo, nil, nil, nil, nil, nil, nil)
			got, err := svc.Handoff(t.Context(), tt.input)
			tt.assert(t, got, err, tt.repo)
		})
	}
}
