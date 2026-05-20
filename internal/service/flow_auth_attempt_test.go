package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// fakeAuthAttemptSvc is a hand-rolled fake of [service.AuthAttemptService]
// that records calls and lets each test pin per-method behavior.
type fakeAuthAttemptSvc struct {
	createFn         func(context.Context, service.CreateAuthAttemptInput) (*domain.AuthAttempt, error)
	issueChallengeFn func(context.Context, service.IssueChallengeInput) (*domain.AuthAttempt, error)
	verifyProofFn    func(context.Context, service.VerifyProofInput) (*domain.AuthAttempt, error)

	issueCalls  []service.IssueChallengeInput
	verifyCalls []service.VerifyProofInput
}

func (f *fakeAuthAttemptSvc) Create(ctx context.Context, in service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
	return f.createFn(ctx, in)
}

func (f *fakeAuthAttemptSvc) GetByID(_ context.Context, _, _ string) (*domain.AuthAttempt, error) {
	panic("unused")
}

func (f *fakeAuthAttemptSvc) IssueChallenge(ctx context.Context, in service.IssueChallengeInput) (*domain.AuthAttempt, error) {
	f.issueCalls = append(f.issueCalls, in)
	return f.issueChallengeFn(ctx, in)
}

func (f *fakeAuthAttemptSvc) VerifyProof(ctx context.Context, in service.VerifyProofInput) (*domain.AuthAttempt, error) {
	f.verifyCalls = append(f.verifyCalls, in)
	return f.verifyProofFn(ctx, in)
}

func (f *fakeAuthAttemptSvc) Handoff(_ context.Context, _ service.HandoffInput) (*domain.AuthAttempt, error) {
	panic("unused")
}

var _ service.AuthAttemptService = (*fakeAuthAttemptSvc)(nil)

func TestFlowAuthAttemptAdapter_Start_DelegatesToCreate(t *testing.T) {
	called := false
	svc := &fakeAuthAttemptSvc{
		createFn: func(_ context.Context, in service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
			called = true
			if in.ProjectID != "proj-1" {
				t.Errorf("ProjectID = %q, want proj-1", in.ProjectID)
			}
			return &domain.AuthAttempt{ID: "att_1"}, nil
		},
	}
	adapter := service.NewFlowAuthAttemptAdapter(svc)

	id, err := adapter.Start(context.Background(), domain.FlowCreateAttemptInput{ProjectID: "proj-1"})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !called {
		t.Fatal("Create was not invoked")
	}
	if id != "att_1" {
		t.Errorf("attempt id = %q, want att_1", id)
	}
}

func TestFlowAuthAttemptAdapter_SubmitIdentifier_HappyPath(t *testing.T) {
	svc := &fakeAuthAttemptSvc{
		issueChallengeFn: func(_ context.Context, _ service.IssueChallengeInput) (*domain.AuthAttempt, error) {
			return &domain.AuthAttempt{
				Checks: []domain.AuthChecker{
					&domain.UserAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser}},
				},
			}, nil
		},
		verifyProofFn: func(_ context.Context, in service.VerifyProofInput) (*domain.AuthAttempt, error) {
			proof, ok := in.Proof.(service.UserProof)
			if !ok {
				t.Fatalf("VerifyProof got %T, want UserProof", in.Proof)
			}
			if proof.LoginName != "alice@example.com" {
				t.Errorf("LoginName = %q, want alice@example.com", proof.LoginName)
			}
			return &domain.AuthAttempt{
				Checks: []domain.AuthChecker{
					&domain.UserAuthCheck{
						AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
						Factor:    &domain.UserFactor{UserID: "user_42"},
					},
				},
			}, nil
		},
	}
	adapter := service.NewFlowAuthAttemptAdapter(svc)

	userID, err := adapter.SubmitIdentifier(context.Background(), domain.FlowSubmitIdentifierInput{
		ProjectID: "proj-1",
		AttemptID: "att_1",
		Value:     "alice@example.com",
	})
	if err != nil {
		t.Fatalf("SubmitIdentifier: %v", err)
	}
	if userID != "user_42" {
		t.Errorf("userID = %q, want user_42", userID)
	}
	if len(svc.issueCalls) != 1 || len(svc.verifyCalls) != 1 {
		t.Fatalf("expected 1 issue + 1 verify; got %d / %d", len(svc.issueCalls), len(svc.verifyCalls))
	}
}

func TestFlowAuthAttemptAdapter_SubmitIdentifier_PassesThroughProofRejected(t *testing.T) {
	rejected := domain.ErrAuthAttemptProofRejected()
	svc := &fakeAuthAttemptSvc{
		issueChallengeFn: func(_ context.Context, _ service.IssueChallengeInput) (*domain.AuthAttempt, error) {
			return &domain.AuthAttempt{}, nil
		},
		verifyProofFn: func(_ context.Context, _ service.VerifyProofInput) (*domain.AuthAttempt, error) {
			return nil, rejected
		},
	}
	adapter := service.NewFlowAuthAttemptAdapter(svc)

	_, err := adapter.SubmitIdentifier(context.Background(), domain.FlowSubmitIdentifierInput{
		ProjectID: "proj-1",
		AttemptID: "att_1",
		Value:     "ghost@nowhere",
	})
	if !errors.Is(err, rejected) {
		t.Fatalf("SubmitIdentifier err = %v, want ErrAuthAttemptProofRejected", err)
	}
}

func TestFlowAuthAttemptAdapter_SubmitPassword_HappyPath(t *testing.T) {
	svc := &fakeAuthAttemptSvc{
		issueChallengeFn: func(_ context.Context, in service.IssueChallengeInput) (*domain.AuthAttempt, error) {
			if _, ok := in.Challenge.(service.PasswordChallenge); !ok {
				t.Errorf("Challenge = %T, want PasswordChallenge", in.Challenge)
			}
			return &domain.AuthAttempt{}, nil
		},
		verifyProofFn: func(_ context.Context, in service.VerifyProofInput) (*domain.AuthAttempt, error) {
			proof, ok := in.Proof.(service.PasswordProof)
			if !ok {
				t.Fatalf("Proof = %T, want PasswordProof", in.Proof)
			}
			if proof.Password != "hunter2" {
				t.Errorf("Password = %q, want hunter2", proof.Password)
			}
			return &domain.AuthAttempt{}, nil
		},
	}
	adapter := service.NewFlowAuthAttemptAdapter(svc)

	if err := adapter.SubmitPassword(context.Background(), domain.FlowSubmitPasswordInput{
		ProjectID: "proj-1",
		AttemptID: "att_1",
		Plain:     "hunter2",
	}); err != nil {
		t.Fatalf("SubmitPassword: %v", err)
	}
}

func TestFlowAuthAttemptAdapter_SubmitPassword_PassesThroughProofRejected(t *testing.T) {
	rejected := domain.ErrAuthAttemptProofRejected()
	svc := &fakeAuthAttemptSvc{
		issueChallengeFn: func(_ context.Context, _ service.IssueChallengeInput) (*domain.AuthAttempt, error) {
			return &domain.AuthAttempt{}, nil
		},
		verifyProofFn: func(_ context.Context, _ service.VerifyProofInput) (*domain.AuthAttempt, error) {
			return nil, rejected
		},
	}
	adapter := service.NewFlowAuthAttemptAdapter(svc)

	err := adapter.SubmitPassword(context.Background(), domain.FlowSubmitPasswordInput{
		ProjectID: "proj-1",
		AttemptID: "att_1",
		Plain:     "wrong",
	})
	if !errors.Is(err, rejected) {
		t.Fatalf("SubmitPassword err = %v, want ErrAuthAttemptProofRejected", err)
	}
}
