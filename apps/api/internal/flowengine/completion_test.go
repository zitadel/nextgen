package flowengine_test

import (
	"errors"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
	flowenginemock "github.com/zitadel/nextgen/internal/flowengine/mock"
)

const completionRefusedKey = "error.completion_refused"

// withCompletion rewires the world's runtime with a completion policy.
func (w *flowTestWorld) withCompletion(policy flowengine.CompletionPolicy) {
	deps := w.deps
	deps.Completion = policy
	w.sm = flowengine.New(deps)
}

// refuseCompletion makes the world's one completion ask a policy that
// refuses it, and forbids the handoff.
func (w *flowTestWorld) refuseCompletion() {
	policy := flowenginemock.NewMockCompletionPolicy(w.mock)
	policy.EXPECT().
		CheckCompletion(gomock.Any(), gomock.Any()).
		Return(domain.FlowStepFailed(completionRefusedKey, nil), nil).
		Times(1)
	w.withCompletion(policy)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)
}

// assertCompletionRefused checks that a refused completion left the flow on
// step with the refusal and nothing of the completion.
func assertCompletionRefused(t *testing.T, result flowengine.StepResult, err error, step string) {
	t.Helper()
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, step, result.Step.Name)
	assert.Equal(t, step, result.State.CurrentStep)
	assert.Nil(t, result.Step.Complete)
	assert.Empty(t, result.HandoffToken)
	if assert.NotNil(t, result.Step.Error) {
		assert.Equal(t, completionRefusedKey, *result.Step.Error)
	}
}

func (w *flowTestWorld) startFlow(t *testing.T, def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) *flowengine.State {
	t.Helper()
	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       purpose,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	return start.State
}

func (w *flowTestWorld) resolveDefaultSchema(t *testing.T) {
	t.Helper()
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
}

// Every submission that completes a flow asks the completion policy once, and
// a refusal leaves the flow on the step it would have completed from.
func TestCompletion_RefusalHoldsEveryProcessPath(t *testing.T) {
	t.Parallel()
	const userID = "user_alice"
	for _, tc := range []struct {
		name string
		// complete drives the flow to its completing submission and returns
		// that submission's result and the step it completes from.
		complete func(t *testing.T, w *flowTestWorld) (flowengine.StepResult, error, string)
	}{
		{
			name: "password sign-in",
			complete: func(t *testing.T, w *flowTestWorld) (flowengine.StepResult, error, string) {
				w.resolveDefaultSchema(t)
				w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
				w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return(userID, nil)
				w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Return(nil)
				def := loginDefinition()
				state := w.startFlow(t, def, domain.FlowDefinitionPurposeLogin)
				result, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{
					Action: flowengine.ActionSubmit,
					Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "secret-password"},
				})
				return result, err, "credentials"
			},
		},
		{
			name: "unknown identifier",
			complete: func(t *testing.T, w *flowTestWorld) (flowengine.StepResult, error, string) {
				w.resolveDefaultSchema(t)
				w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
				w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("", domain.ErrAuthAttemptProofRejected(nil))
				def := loginDefinition()
				state := w.startFlow(t, def, domain.FlowDefinitionPurposeLogin)
				result, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{
					Action: flowengine.ActionSubmit,
					Fields: map[string]any{"email": "nobody@example.com", "x-auth-methods#password": "secret-password"},
				})
				return result, err, "credentials"
			},
		},
		{
			name: "create_user",
			complete: func(t *testing.T, w *flowTestWorld) (flowengine.StepResult, error, string) {
				w.resolveDefaultSchema(t)
				w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
				w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("", domain.ErrAuthAttemptProofRejected(nil))
				w.createUser.EXPECT().Handle(gomock.Any(), gomock.Any()).Return(flowengine.OnSuccessResult{UserID: userID, Irreversible: true}, nil)
				def := signupDefinition()
				state := w.startFlow(t, def, domain.FlowDefinitionPurposeRegister)
				result, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{
					Action: flowengine.ActionSubmit,
					Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "secret-password"},
				})
				return result, err, "credentials"
			},
		},
		{
			name: "navigate",
			complete: func(t *testing.T, w *flowTestWorld) (flowengine.StepResult, error, string) {
				w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
				def := navigateOnlyDefinition()
				state := w.startFlow(t, def, domain.FlowDefinitionPurposeLogin)
				mid, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{Action: "go"})
				require.NoError(t, err)
				result, err := w.sm.Process(t.Context(), served(def), mid.State, flowengine.SubmitInput{Action: "go"})
				return result, err, "step2"
			},
		},
		{
			name: "passkey sign-in",
			complete: func(t *testing.T, w *flowTestWorld) (flowengine.StepResult, error, string) {
				w.resolveDefaultSchema(t)
				w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
				w.authAttemptService.EXPECT().IssueChallenge(gomock.Any(), gomock.Any()).
					Return(flowengine.IssuedChallenge{ChallengeID: "ch-1", Options: []byte(`{}`)}, nil)
				w.authAttemptService.EXPECT().VerifyChallenge(gomock.Any(), gomock.Any()).Return(userID, nil)
				def := passkeyLoginDefinition()
				state := w.startFlow(t, def, domain.FlowDefinitionPurposeLogin)
				issued, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{
					Action:    flowengine.ActionPasskey,
					PasskeyRP: &flowengine.PasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
				})
				require.NoError(t, err)
				result, err := w.sm.Process(t.Context(), served(def), issued.State, flowengine.SubmitInput{
					Action:            flowengine.ActionPasskey,
					ChallengeResponse: &flowengine.ChallengeResponse{ChallengeID: "ch-1", Method: flowengine.ChallengeMethodPasskey, Proof: []byte(`{}`)},
				})
				return result, err, "authenticate"
			},
		},
		{
			name: "passkey registration",
			complete: func(t *testing.T, w *flowTestWorld) (flowengine.StepResult, error, string) {
				w.resolveDefaultSchema(t)
				w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
				w.authAttemptService.EXPECT().IssueChallenge(gomock.Any(), gomock.Any()).
					Return(flowengine.IssuedChallenge{ChallengeID: "reg-1", UserID: userID, Options: []byte(`{}`)}, nil)
				w.authAttemptService.EXPECT().VerifyChallenge(gomock.Any(), gomock.Any()).Return("", nil)
				def := passkeyRegisterDefinition()
				state := w.startFlow(t, def, domain.FlowDefinitionPurposeLogin)
				issued, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{
					Action:    flowengine.ActionPasskeyRegister,
					PasskeyRP: &flowengine.PasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
				})
				require.NoError(t, err)
				result, err := w.sm.Process(t.Context(), served(def), issued.State, flowengine.SubmitInput{
					Action:            flowengine.ActionPasskeyRegister,
					ChallengeResponse: &flowengine.ChallengeResponse{ChallengeID: "reg-1", Method: flowengine.ChallengeMethodPasskeyRegister, Proof: []byte(`{}`)},
				})
				return result, err, "register"
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			w.refuseCompletion()
			result, err, step := tc.complete(t, w)
			assertCompletionRefused(t, result, err, step)
		})
	}
}

// A render that resolves an external sign-in into a completion asks the
// completion policy as a submission does.
func TestCompletion_RefusalHoldsEveryRenderPath(t *testing.T) {
	t.Parallel()
	for _, tt := range ssoHandoffPaths {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			tt.expect(w)
			w.refuseCompletion()

			result, err := w.sm.Render(t.Context(), served(def), state)
			assertCompletionRefused(t, result, err, "credentials")
		})
	}
	t.Run("collection step retry", func(t *testing.T) {
		t.Parallel()
		w, def, state := boundCollectionStepWorld(t)
		w.refuseCompletion()

		result, err := w.sm.Render(t.Context(), served(def), state)
		assertCompletionRefused(t, result, err, "sso-register")
	})
}

// The policy is asked with the flow still on the step it completes from, and
// a flow it lets through completes as without a policy.
func TestCompletion_ProceedCompletes(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	w.resolveDefaultSchema(t)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("user_alice", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Return(nil)
	policy := flowenginemock.NewMockCompletionPolicy(w.mock)
	policy.EXPECT().
		CheckCompletion(gomock.Any(), gomock.Cond(func(in flowengine.CompletionCheckInput) bool {
			return in.ProjectID == testProjectID && in.AttemptID == "att_1" &&
				in.State.CurrentStep == "credentials" && in.State.CollectedData.UserID == "user_alice"
		})).
		Return(nil, nil)
	w.withCompletion(policy)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), flowengine.HandoffInput{ProjectID: testProjectID, AttemptID: "att_1"}).
		Return(flowengine.HandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)

	def := loginDefinition()
	state := w.startFlow(t, def, domain.FlowDefinitionPurposeLogin)
	result, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "secret-password"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", result.State.CurrentStep)
	assert.NotNil(t, result.Step.Complete)
	assert.Equal(t, "handoff-1", result.HandoffToken)
}

// A policy that cannot decide fails the submission; the flow does not
// complete.
func TestCompletion_PolicyErrorFailsTheSubmission(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)
	policy := flowenginemock.NewMockCompletionPolicy(w.mock)
	unavailable := errors.New("policy store unavailable")
	policy.EXPECT().CheckCompletion(gomock.Any(), gomock.Any()).Return(nil, unavailable)
	w.withCompletion(policy)

	def := navigateOnlyDefinition()
	state := w.startFlow(t, def, domain.FlowDefinitionPurposeLogin)
	mid, err := w.sm.Process(t.Context(), served(def), state, flowengine.SubmitInput{Action: "go"})
	require.NoError(t, err)
	_, err = w.sm.Process(t.Context(), served(def), mid.State, flowengine.SubmitInput{Action: "go"})
	require.ErrorIs(t, err, unavailable)
}
