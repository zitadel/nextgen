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
	issueSSOStateIn  service.IssueSSOStateInput
	issueSSOState    *domain.SSOState
	issueSSOStateErr error
	consumeState     string
	consumeNonce     string
	consumeCheck     *domain.SSOCallbackCheck
	consumeErr       error
	setResultCheck   *domain.SSOCallbackCheck
	setResult        *domain.SSOCallbackResult
	setResultEvent   domain.EventType
	// setResultErrs answers SetSSOCallbackResult calls in order; a call past
	// the end succeeds.
	setResultErrs []error
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

func (f *fakeAuthAttempts) IssueSSOState(_ context.Context, in service.IssueSSOStateInput) (*domain.SSOState, error) {
	f.issueSSOStateIn = in
	return f.issueSSOState, f.issueSSOStateErr
}

func (f *fakeAuthAttempts) ConsumeSSOState(_ context.Context, _, state, bindingNonce string) (*domain.SSOCallbackCheck, error) {
	f.consumeState, f.consumeNonce = state, bindingNonce
	return f.consumeCheck, f.consumeErr
}

func (f *fakeAuthAttempts) SetSSOCallbackResult(_ context.Context, _ string, check *domain.SSOCallbackCheck, result *domain.SSOCallbackResult, eventType domain.EventType) error {
	f.setResultCheck, f.setResult, f.setResultEvent = check, result, eventType
	if len(f.setResultErrs) == 0 {
		return nil
	}
	err := f.setResultErrs[0]
	f.setResultErrs = f.setResultErrs[1:]
	return err
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
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

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
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

	userID, err := adapter.SubmitIdentifier(context.Background(), domain.FlowSubmitIdentifierInput{
		ProjectID:     "proj-1",
		AttemptID:     "att-1",
		AttributeName: "email",
		Value:         "alice@example.com",
		UserSchemaURL: "sch_human",
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
	assert.Equal(t, "sch_human", proof.UserSchemaURL)
}

func TestFlowAuthAttemptAdapter_SubmitIdentifier_ProofRejectedSurfaces(t *testing.T) {
	fake := &fakeAuthAttempts{
		issueAttempt: attemptWithUserChallenge("ch-user"),
		verifyErr:    domain.ErrAuthAttemptProofRejected(errors.New("no such user")),
	}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

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
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

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
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

	err := adapter.SubmitPassword(context.Background(), domain.FlowSubmitPasswordInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
		Plain:     "wrong-password",
	})
	assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
}

// recordingSignupProtection records what each Consume spends.
type recordingSignupProtection struct {
	stubSignupProtection
	consumed []string
	state    *domain.FlowState
}

func (r *recordingSignupProtection) Consume(_ context.Context, state *domain.FlowState, proof string) error {
	r.consumed = append(r.consumed, proof)
	r.state = state
	return r.err
}

// submitRegistration runs the adapter's passkey registration and returns the
// create-user factory it handed the attempt service, which calls it only for
// a provisional ceremony.
func submitRegistration(t *testing.T, protection service.SignupProtection, in domain.FlowSubmitPasskeyRegistrationInput) func(context.Context, string) ([]service.UserAction, error) {
	t.Helper()
	fake := &fakeAuthAttempts{verifyAttempt: &domain.AuthAttempt{}}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, protection)
	require.NoError(t, adapter.SubmitPasskeyRegistration(t.Context(), in))
	require.Equal(t, "ch-reg", fake.verifyIn.ChallengeID)
	proof, ok := fake.verifyIn.Proof.(service.PasskeyRegistrationProof)
	require.True(t, ok, "expected a PasskeyRegistrationProof")
	require.NotNil(t, proof.CreateUser)
	return proof.CreateUser
}

func registrationInput(state *domain.FlowState) domain.FlowSubmitPasskeyRegistrationInput {
	return domain.FlowSubmitPasskeyRegistrationInput{
		ProjectID:      "proj-1",
		AttemptID:      "att-1",
		ChallengeID:    "ch-reg",
		Attestation:    []byte(`{}`),
		UserSchemaURL:  "sch_human",
		UserAttributes: map[string]any{"email": "alice@example.com"},
		State:          state,
		GateProofs:     map[string]string{domain.SignupGate: "proof-1"},
	}
}

// A passkey registration that creates its user is a sign-up: the user is
// built only after the flow's proof is spent.
func TestFlowAuthAttemptAdapter_SubmitPasskeyRegistration_SpendsTheSignupProof(t *testing.T) {
	state := &domain.FlowState{ID: "flow-1", ProjectID: "proj-1"}
	protection := &recordingSignupProtection{}
	createUser := submitRegistration(t, protection, registrationInput(state))
	assert.Empty(t, protection.consumed, "verification decides whether the ceremony creates a user")

	actions, err := createUser(t.Context(), "user_minted")
	require.NoError(t, err)
	assert.Len(t, actions, 1)
	assert.Equal(t, []string{"proof-1"}, protection.consumed)
	assert.Same(t, state, protection.state, "the proof is bound to the flow it was issued for")
}

func TestFlowAuthAttemptAdapter_SubmitPasskeyRegistration_RefusedProofBuildsNoUser(t *testing.T) {
	protection := &recordingSignupProtection{stubSignupProtection: stubSignupProtection{err: domain.ErrFlowProofInvalid()}}
	createUser := submitRegistration(t, protection, registrationInput(&domain.FlowState{ID: "flow-1", ProjectID: "proj-1"}))

	actions, err := createUser(t.Context(), "user_minted")
	require.ErrorIs(t, err, domain.ErrFlowProofInvalid())
	assert.Empty(t, actions)
}

func TestFlowAuthAttemptAdapter_SubmitPasskeyRegistration_NeedsItsFlow(t *testing.T) {
	for name, state := range map[string]*domain.FlowState{
		"no flow":         nil,
		"another project": {ID: "flow-1", ProjectID: "proj-2"},
	} {
		t.Run(name, func(t *testing.T) {
			protection := &recordingSignupProtection{}
			createUser := submitRegistration(t, protection, registrationInput(state))
			_, err := createUser(t.Context(), "user_minted")
			require.ErrorIs(t, err, domain.ErrFlowIntegrity())
			assert.Empty(t, protection.consumed)
		})
	}
}

func attemptWithHandoff(t *testing.T, handedOffAt time.Time) *domain.AuthAttempt {
	t.Helper()
	// A completed attempt carries a verified credential-class factor; the bare
	// identifier never completes one (see domain.AuthAttempt.IsCompleted).
	att := &domain.AuthAttempt{Checks: []domain.AuthCheck{domain.SetAuthFactorPassword(time.Now())}}
	require.NoError(t, att.PrepareHandoff())
	att.HandedOffAt = &handedOffAt
	return att
}

func TestFlowAuthAttemptAdapter_Handoff_HappyPath(t *testing.T) {
	handedOffAt := time.Unix(1700000000, 0).UTC()
	attempt := attemptWithHandoff(t, handedOffAt)
	fake := &fakeAuthAttempts{handoffAttempt: attempt}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

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
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

	_, err := adapter.Handoff(context.Background(), domain.FlowHandoffInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "handoff token missing")
}

func TestFlowAuthAttemptAdapter_Handoff_PropagatesServiceError(t *testing.T) {
	fake := &fakeAuthAttempts{handoffErr: errors.New("boom")}
	adapter := service.NewFlowAuthAttemptAdapter(fake, nil, nil)

	_, err := adapter.Handoff(context.Background(), domain.FlowHandoffInput{
		ProjectID: "proj-1",
		AttemptID: "att-1",
	})
	require.EqualError(t, err, "boom")
}
