package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// fakeAuthAttempts captures the AuthAttemptService calls the adapter
// drives so tests can assert the issue-then-verify sequencing.
type fakeAuthAttempts struct {
	createIn         service.CreateAuthAttemptInput
	createAttempt    *domain.AuthAttempt
	createErr        error
	issueIn          service.IssueChallengeInput
	issueAttempt     *domain.AuthAttempt
	issueErr         error
	verifyIn         service.VerifyProofInput
	verifyAttempt    *domain.AuthAttempt
	verifyErr        error
	handoffIn        service.HandoffInput
	handoffAttempt   *domain.AuthAttempt
	handoffErr       error
	getByIDProjectID string
	getByIDAttemptID string
}

func (f *fakeAuthAttempts) Create(_ context.Context, in service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
	f.createIn = in
	return f.createAttempt, f.createErr
}

func (f *fakeAuthAttempts) GetByID(_ context.Context, projectID, attemptID string) (*domain.AuthAttempt, error) {
	f.getByIDProjectID, f.getByIDAttemptID = projectID, attemptID
	return f.createAttempt, nil
}

func (f *fakeAuthAttempts) IssueChallenge(_ context.Context, in service.IssueChallengeInput) (*domain.AuthAttempt, error) {
	f.issueIn = in
	return f.issueAttempt, f.issueErr
}

func (f *fakeAuthAttempts) VerifyProof(_ context.Context, in service.VerifyProofInput) (*domain.AuthAttempt, error) {
	f.verifyIn = in
	return f.verifyAttempt, f.verifyErr
}

func (f *fakeAuthAttempts) Handoff(_ context.Context, in service.HandoffInput) (*domain.AuthAttempt, error) {
	f.handoffIn = in
	return f.handoffAttempt, f.handoffErr
}

func (f *fakeAuthAttempts) BeginPasskeyEnrollment(context.Context, service.BeginPasskeyEnrollmentInput) (*service.BeginPasskeyEnrollmentOutput, error) {
	return nil, errors.New("not used by the flow adapter")
}

func (f *fakeAuthAttempts) FinishPasskeyEnrollment(context.Context, service.FinishPasskeyEnrollmentInput) (*service.FinishPasskeyEnrollmentOutput, error) {
	return nil, errors.New("not used by the flow adapter")
}

func attemptWithUserChallenge(id string) *domain.AuthAttempt {
	att := &domain.AuthAttempt{}
	ch := att.SetUserChallenge()
	ch.SetID(id)
	return att
}

func attemptWithUserFactor(challengeID, userID string) *domain.AuthAttempt {
	att := attemptWithUserChallenge(challengeID)
	user := &domain.User{ID: userID}
	att.SetUserFactor(user)
	return att
}

func attemptWithPasswordChallenge(challengeID string) *domain.AuthAttempt {
	att := &domain.AuthAttempt{}
	ch := att.SetPasswordChallenge()
	ch.SetID(challengeID)
	return att
}

func TestFlowAuthAttemptAdapter_Start_ReturnsAttemptID(t *testing.T) {
	fake := &fakeAuthAttempts{
		createAttempt: &domain.AuthAttempt{ProjectID: "proj-1", ID: "att-1"},
	}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	id, err := adapter.Start(context.Background(), domain.FlowCreateAttemptInput{
		ProjectID: "proj-1",
	})
	require.NoError(t, err)
	assert.Equal(t, "att-1", id)
	assert.Equal(t, "proj-1", fake.createIn.ProjectID)
}

func TestFlowAuthAttemptAdapter_SubmitIdentifier_HappyPath(t *testing.T) {
	fake := &fakeAuthAttempts{
		issueAttempt:  attemptWithUserChallenge("ch-user"),
		verifyAttempt: attemptWithUserFactor("ch-user", "user-1"),
	}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	userID, err := adapter.SubmitIdentifier(context.Background(), domain.FlowSubmitIdentifierInput{
		ProjectID:     "proj-1",
		AttemptID:     "att-1",
		AttributeName: "email",
		Value:         "alice@example.com",
	})
	require.NoError(t, err)
	assert.Equal(t, "user-1", userID)

	assert.Equal(t, "proj-1", fake.issueIn.ProjectID)
	assert.Equal(t, "att-1", fake.issueIn.AttemptID)
	assert.IsType(t, service.UserChallenge{}, fake.issueIn.Challenge, "expected a UserChallenge")

	require.Equal(t, "ch-user", fake.verifyIn.ChallengeID)
	require.IsType(t, service.UserProof{}, fake.verifyIn.Proof, "expected a UserProof")
	proof := fake.verifyIn.Proof.(service.UserProof)
	assert.Equal(t, "email", proof.AttributeName)
	assert.Equal(t, "alice@example.com", proof.LoginName)
}

func TestFlowAuthAttemptAdapter_SubmitIdentifier_ProofRejectedSurfaces(t *testing.T) {
	fake := &fakeAuthAttempts{
		issueAttempt: attemptWithUserChallenge("ch-user"),
		verifyErr:    domain.ErrAuthAttemptProofRejected(errors.New("no such user")),
	}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	_, err := adapter.SubmitIdentifier(context.Background(), domain.FlowSubmitIdentifierInput{
		ProjectID:     "proj-1",
		AttemptID:     "att-1",
		AttributeName: "email",
		Value:         "ghost@example.com",
	})
	assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
}

func TestFlowAuthAttemptAdapter_SubmitPassword_HappyPath(t *testing.T) {
	fake := &fakeAuthAttempts{
		issueAttempt:  attemptWithPasswordChallenge("ch-pw"),
		verifyAttempt: &domain.AuthAttempt{},
	}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	err := adapter.SubmitPassword(context.Background(), domain.FlowSubmitPasswordInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
		Plain:     "correct-horse-battery-staple",
	})
	require.NoError(t, err)

	assert.IsType(t, service.PasswordChallenge{}, fake.issueIn.Challenge, "expected a PasswordChallenge")

	require.Equal(t, "ch-pw", fake.verifyIn.ChallengeID)
	require.IsType(t, service.PasswordProof{}, fake.verifyIn.Proof, "expected a PasswordProof")
	proof := fake.verifyIn.Proof.(service.PasswordProof)
	assert.Equal(t, "correct-horse-battery-staple", proof.Password)
}

func TestFlowAuthAttemptAdapter_SubmitPassword_ProofRejectedSurfaces(t *testing.T) {
	fake := &fakeAuthAttempts{
		issueAttempt: attemptWithPasswordChallenge("ch-pw"),
		verifyErr:    domain.ErrAuthAttemptProofRejected(errors.New("hash mismatch")),
	}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	err := adapter.SubmitPassword(context.Background(), domain.FlowSubmitPasswordInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
		Plain:     "wrong-password",
	})
	assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
}

func attemptWithHandoff(t *testing.T, handedOffAt time.Time) *domain.AuthAttempt {
	t.Helper()
	att := &domain.AuthAttempt{}
	require.NoError(t, att.PrepareHandoff())
	att.HandedOffAt = &handedOffAt
	return att
}

func TestFlowAuthAttemptAdapter_Handoff_HappyPath(t *testing.T) {
	handedOffAt := time.Unix(1700000000, 0).UTC()
	attempt := attemptWithHandoff(t, handedOffAt)
	fake := &fakeAuthAttempts{handoffAttempt: attempt}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	out, err := adapter.Handoff(context.Background(), domain.FlowHandoffInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
	})
	require.NoError(t, err)
	assert.Equal(t, attempt.HandoffToken.Plain(), out.Token)
	assert.Equal(t, attempt.HandoffToken.ExpiresAt(&handedOffAt), out.ExpiresAt)
	assert.Equal(t, "proj-1", fake.handoffIn.ProjectID)
	assert.Equal(t, "att-1", fake.handoffIn.AttemptID)
}

func TestFlowAuthAttemptAdapter_Handoff_NilTokenIsError(t *testing.T) {
	fake := &fakeAuthAttempts{handoffAttempt: &domain.AuthAttempt{}}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	_, err := adapter.Handoff(context.Background(), domain.FlowHandoffInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "handoff token missing")
}

func TestFlowAuthAttemptAdapter_Handoff_PropagatesServiceError(t *testing.T) {
	fake := &fakeAuthAttempts{handoffErr: errors.New("boom")}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil)

	_, err := adapter.Handoff(context.Background(), domain.FlowHandoffInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
	})
	require.EqualError(t, err, "boom")
}
