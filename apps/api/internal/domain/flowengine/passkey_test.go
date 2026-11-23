package flowengine_test

import (
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/flowengine"
)

// issuesChallenge matches an issue whose params are a P that match accepts;
// a nil match accepts any P.
func issuesChallenge[P domain.FlowChallengeParams](match func(in domain.FlowIssueChallengeInput, params P) bool) gomock.Matcher {
	return gomock.Cond(func(in domain.FlowIssueChallengeInput) bool {
		params, ok := in.Params.(P)
		return ok && (match == nil || match(in, params))
	})
}

// verifiesChallenge matches a verification of check that match accepts; a nil
// match accepts any.
func verifiesChallenge(check domain.AuthCheckType, match func(in domain.FlowVerifyChallengeInput) bool) gomock.Matcher {
	return gomock.Cond(func(in domain.FlowVerifyChallengeInput) bool {
		return in.Check == check && (match == nil || match(in))
	})
}

// passkeyLoginDefinition builds a single-step passkey login: an
// `authenticate` step offering the `passkey` action, transitioning to the
// `done` terminal once the assertion verifies.
func passkeyLoginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "authenticate",
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionPasskey: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Process_PasskeyIssueThenVerify(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const userID = "user_alice"
	const challengeID = "ch-1"
	const rpid = "example.com"
	const proof = `{"id":"x"}`
	const publicKey = `{"publicKey":{}}`
	const handoffToken = "handoff_01TEST"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge(func(in domain.FlowIssueChallengeInput, params domain.FlowPasskeyChallengeParams) bool {
			return params.RPID == rpid
		})).
		Return(domain.FlowIssuedChallenge{ChallengeID: challengeID, Options: []byte(publicKey)}, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskey, func(in domain.FlowVerifyChallengeInput) bool {
			return in.ChallengeID == challengeID && string(in.Proof) == proof
		})).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{
		Token:     handoffToken,
		ExpiresAt: time.Unix(1700000060, 0).UTC(),
	}, nil)

	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Issue leg: selecting the passkey action mints a challenge and halts on the
	// same step, surfacing the ceremony options.
	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: rpid, Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
	assert.Equal(t, flowengine.FlowChallengeMethodPasskey, issued.Step.Challenge.Method)
	assert.Equal(t, publicKey, string(issued.Step.Challenge.Options))
	require.NotNil(t, issued.State.PendingChallenge)
	assert.Equal(t, "authenticate", issued.State.CurrentStep)

	// Verify leg: the signed assertion clears the challenge and advances.
	verified, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action:            flowengine.FlowActionPasskey,
		ChallengeResponse: &flowengine.FlowChallengeResponse{ChallengeID: challengeID, Method: "passkey", Proof: []byte(proof)},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.NotNil(t, verified.Step.Complete)
	assert.Equal(t, handoffToken, verified.HandoffToken)
	assert.Equal(t, userID, verified.State.CollectedData.UserID)
}

func TestFlowStateMachine_Process_PasskeyProofRejectedKeepsStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const challengeID = "ch-1"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil)
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskey, nil)).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action:            flowengine.FlowActionPasskey,
		ChallengeResponse: &flowengine.FlowChallengeResponse{ChallengeID: challengeID, Proof: []byte(`{}`)},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorPasskeyInvalid, *rejected.Step.Error)
	require.NotNil(t, rejected.Step.Failure)
	assert.ErrorIs(t, rejected.Step.Failure.Cause, domain.ErrAuthAttemptProofRejected(nil))
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "authenticate", rejected.State.CurrentStep)
}

// passkeyAbandonDefinition offers both a `passkey` and a generic `submit`
// action on the same step, with separate transition targets. Lets a test
// issue a passkey challenge and then submit `submit` to exercise the
// abandonment path.
func passkeyAbandonDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-abandon",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "authenticate",
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},

					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionPasskey: {Target: "done"},
					flowengine.FlowActionSubmit:  {Target: "fallback"},
				},
			},
			{Name: "done", Complete: &show},
			{Name: "fallback", Complete: &show},
		},
	}
}

// Submitting a non-passkey action while a passkey challenge is pending must
// clear the challenge and route via the submitted action, instead of
// re-emitting the passkey prompt and trapping the user on the ceremony.
func TestFlowStateMachine_Process_PasskeyAbandonedOnDifferentAction(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}, nil)
	// no passkey verification should run when no proof was submitted
	w.authAttemptService.EXPECT().VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskey, nil)).Times(0)

	def := passkeyAbandonDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	abandoned, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
	})
	require.NoError(t, err)
	assert.Nil(t, abandoned.State.PendingChallenge, "pending challenge must be cleared when the user picks a different action")
	assert.Nil(t, abandoned.Step.Challenge, "the rendered step must not re-attach the abandoned passkey challenge")
	require.NotNil(t, abandoned.Step.Complete, "submit action should advance to the fallback terminal")
}

// passkeyIdentifierLoginDefinition builds a login step that collects the
// identifier on the same step that offers the passkey action — the shape
// the discoverable/non-discoverable passkey UI submits (email + "Login
// with passkey" click).
func passkeyIdentifierLoginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-identifier",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "authenticate",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionPasskey:           {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "not_found"},
				},
			},
			{Name: "done", Complete: &show},
			{Name: "not_found", Complete: &show},
		},
	}
}

// Repro for the "passkey login only works after refresh when two users share
// the browser" bug: after attempt 1 rejects (user1 has no passkey), the
// stored _user_id from attempt 1 must not block re-identifying user2 on
// attempt 2. Otherwise the new challenge is still scoped to user1 and the
// second user can never log in.
func TestFlowStateMachine_Process_PasskeyAfterRejectionRebindsIdentifier(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"
	const publicKey = `{"publicKey":{}}`

	const email1 = "user1@example.com"
	const userID1 = "user_one"
	const challengeID1 = "ch-1"

	const challengeID2 = "ch-2"
	const email2 = "user2@example.com"
	const userID2 = "user_two"

	w := newFlowTestWorld(t)
	def := passkeyIdentifierLoginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()

	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email1 == in.Value
		})).
		Return(userID1, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{ChallengeID: challengeID1, Options: []byte(publicKey)}, nil)
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskey, func(in domain.FlowVerifyChallengeInput) bool {
			return in.ChallengeID == challengeID1 && string(in.Proof) == `{}`
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Attempt 1, issue leg: user1 (password-only) types their email and
	// clicks "Login with passkey". The dispatch loop identifies user1, then
	// processPasskey mints a challenge scoped to user1 (empty allowCredentials
	// since user1 has no passkey).
	issued1, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		Fields:    map[string]any{"email": email1},
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued1.State.PendingChallenge)
	assert.Equal(t, "user_one", issued1.State.CollectedData.UserID)

	// Attempt 1, verify leg: the assertion that comes back doesn't match any
	// credential the attempt is constrained to → server rejects.
	rejected, err := w.sm.Process(t.Context(), def, issued1.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionPasskey,
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: challengeID1,
			Method:      flowengine.FlowChallengeMethodPasskey, Proof: []byte(`{}`),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, flowengine.FlowStepErrorPasskeyInvalid, gu.Value(rejected.Step.Error))
	assert.Nil(t, rejected.State.PendingChallenge, "rejection clears PendingChallenge")

	// Attempt 2, issue leg: the user re-types user2's email (passkey-only)
	// and clicks "Login with passkey" again. user2 must be re-identified so
	// the new challenge is scoped to user2's credentials. Before this fix,
	// the dispatch loop skipped SubmitIdentifier whenever a previous _user_id
	// was stored, leaving the attempt bound to user1.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email2 == in.Value
		})).
		Return(userID2, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{ChallengeID: challengeID2, Options: []byte(publicKey)}, nil)

	issued2, err := w.sm.Process(t.Context(), def, rejected.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		Fields:    map[string]any{"email": "user2@example.com"},
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued2.State.PendingChallenge, "attempt 2 must issue a fresh passkey challenge")

	assert.Equal(t, "user_two", issued2.State.CollectedData.UserID,
		"_user_id must be rebound to user_two so the new passkey challenge is scoped to their credentials")
}

// Re-submitting the same identifier resolves to the same user, so the
// in-flight ceremony survives. The dispatch re-runs (the auth-attempt is
// the source of truth for whether the binding should change); the resolved
// user id is the same, so PendingChallenge is preserved.
func TestFlowStateMachine_Process_PasskeyResubmitSameIdentifierKeepsPendingChallenge(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"
	const publicKey = `{"publicKey":{}}`
	const email = "user1@example.com"
	const userID = "user_one"
	const challengeID = "ch-1"

	w := newFlowTestWorld(t)
	def := passkeyIdentifierLoginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email == in.Value
		})).
		Return(userID, nil).
		Times(2)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{ChallengeID: challengeID, Options: []byte(publicKey)}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	first, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)

	// Same email re-submitted (e.g. user clicked the passkey action again
	// after dismissing the browser prompt). Same user resolved → ceremony stays.
	second, err := w.sm.Process(t.Context(), def, first.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, second.State.PendingChallenge, "same user resolved — ceremony survives")
	assert.Equal(t, "user_one", second.State.CollectedData.UserID)
}

// passkeyRegisterDefinition builds a two-step registration flow:
// an `identify` step (identifier field) followed by a `register` step
// offering the `passkey_register` action, transitioning to `done`.
func passkeyRegisterDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "register",
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func passkeyRegisterAfterIdentifierDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg-with-identifier",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "register"},
				},
			},
			{
				Name: "register",
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func passkeyRegisterAfterUsernameAndEmailDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg-with-username-and-email",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"username", "email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "register"},
				},
			},
			{
				Name: "register",
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Process_PasskeyRegisterIssueThenVerify(t *testing.T) {
	t.Parallel()
	const userID = "user_01TEST"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const proof = `{"attestation":"fake"}`

	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge(func(in domain.FlowIssueChallengeInput, params domain.FlowPasskeyRegistrationChallengeParams) bool {
			return assert.Equal(t, "attempt-1", in.AttemptID) && assert.Empty(t, params.UserID)
		})).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskeyRegistration, func(in domain.FlowVerifyChallengeInput) bool {
			// The attempt service decides whether the ceremony creates its
			// user; when it does, the flow's sign-up proof pays for it.
			return assert.Equal(t, "attempt-1", in.AttemptID) &&
				assert.Equal(t, challengeID, in.ChallengeID) &&
				assert.Equal(t, proof, string(in.Proof)) &&
				assert.NotNil(t, in.SignUp) &&
				assert.NotNil(t, in.SignUp.State) &&
				assert.Equal(t, map[string]string{domain.SignupGate: "pow-proof"}, in.SignUp.GateProofs)
		}))
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Issue leg: passkey_register action mints a creation challenge.
	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
	assert.Equal(t, flowengine.FlowChallengeMethodPasskeyRegister, issued.Step.Challenge.Method)
	require.NotNil(t, issued.State.PendingChallenge)

	// Verify leg: attestation clears the challenge and advances to done.
	verified, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action:     flowengine.FlowActionPasskeyRegister,
		GateProofs: map[string]string{domain.SignupGate: "pow-proof"},
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      flowengine.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(proof),
		},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.NotNil(t, verified.Step.Complete)
	assert.Equal(t, userID, verified.State.CollectedData.UserID, "the flow's user is the handle the challenge was issued for")
	// Passkey registration writes a credential — irreversible. The back
	// stack drops so no `back` action leaks past the mutation boundary,
	// while History keeps the visitation trail.
	assert.Empty(t, verified.State.BackStack, "passkey-register verify must clear the back stack")
	assert.Equal(t, []string{"register"}, verified.State.History, "audit history records the visit even after an irreversible advance")
}

// The sign-up proof rides only on a submission that can create a user: a
// passkey registration takes it with the attestation, not with the action
// that asks for the ceremony.
func TestFlowStateMachine_Process_PasskeyRegisterTakesTheSignupProofOnlyWithTheAttestation(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:     flowengine.FlowActionPasskeyRegister,
		GateProofs: map[string]string{domain.SignupGate: "pow-proof"},
		PasskeyRP:  &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.ErrorIs(t, err, domain.ErrFlowUnsupported())
}

// With no registration pending, only a passkey registration's attestation may
// bring the sign-up proof. Another challenge response, such as a passkey
// sign-in's assertion on a step that offers both, is refused with it.
func TestFlowStateMachine_Process_SignupProofRefusedWithAnotherChallengeResponse(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionPasskeyRegister,
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: "assert-1",
			Method:      flowengine.FlowChallengeMethodPasskey,
			Proof:       []byte(`{}`),
		},
		GateProofs: map[string]string{domain.SignupGate: "pow-proof"},
	})
	require.ErrorIs(t, err, domain.ErrFlowUnsupported())
}

// A step announces the sign-up gate for as long as it carries a passkey
// registration, so a client solves it for whatever it submits next. The
// password path a person falls back to after a cancelled prompt brings the
// proof with it: the submit is taken, the ceremony dropped and nothing spent.
func TestFlowStateMachine_Process_PasskeyRegisterAbandonedWithTheSignupProof(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	submit := domain.FlowStepAction{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit}
	def := passkeyRegisterDefinition()
	def.Steps[0].Actions = append(def.Steps[0].Actions, submit)
	def.Steps[0].Transitions[flowengine.FlowActionSubmit] = domain.FlowStepTransition{Target: "password"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{
		Name:        "password",
		Actions:     []domain.FlowStepAction{submit},
		Transitions: map[string]domain.FlowStepTransition{flowengine.FlowActionSubmit: {Target: "done"}},
	})

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyRegistrationChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: "reg-1",
			UserID:      "user_01TEST",
			Options:     []byte(`{"rp":{"id":"example.com"}}`),
		}, nil)
	// No attestation arrived, so nothing is verified and no proof is spent.
	w.authAttemptService.EXPECT().VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskeyRegistration, nil)).Times(0)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	fallback, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action:     flowengine.FlowActionSubmit,
		GateProofs: map[string]string{domain.SignupGate: "pow-proof"},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", fallback.State.CurrentStep)
	assert.Nil(t, fallback.State.PendingChallenge, "the abandoned ceremony is dropped")
	assert.Nil(t, fallback.Step.Challenge)
}

func TestFlowStateMachine_Process_PasskeyRegisterRejectedKeepsStep(t *testing.T) {
	t.Parallel()
	const userID = "user_alice"
	const challengeID = "reg-1"
	const registrationOpts = `{}`
	const proof = `{}`

	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge(func(in domain.FlowIssueChallengeInput, params domain.FlowPasskeyRegistrationChallengeParams) bool {
			return assert.Equal(t, userID, params.UserID)
		})).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskeyRegistration, func(in domain.FlowVerifyChallengeInput) bool {
			return assert.Equal(t, challengeID, in.ChallengeID) &&
				assert.Equal(t, proof, string(in.Proof))
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	start.State.CollectedData.UserID = "user_alice"

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionPasskeyRegister,
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      flowengine.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(proof),
		},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorPasskeyRegistrationInvalid, *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "register", rejected.State.CurrentStep)
}

// TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID verifies that
// when no user is identified yet (passkey-only registration path), the attempt
// service mints a provisional user handle (returned on the issue output) and
// the state machine stores it for the verify phase.
func TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID(t *testing.T) {
	t.Parallel()
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const userID = "user_01TEST"
	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge(func(in domain.FlowIssueChallengeInput, params domain.FlowPasskeyRegistrationChallengeParams) bool {
			return assert.Empty(t, params.UserID) &&
				assert.Empty(t, params.Username) &&
				assert.Empty(t, params.DisplayName)
		})).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, userID, issued.State.CollectedData.UserID)
}

func TestFlowStateMachine_Process_PasskeyRegisterUsesCollectedIdentifierForDisplay(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const userID = "user_01TEST"
	w := newFlowTestWorld(t)
	def := passkeyRegisterAfterIdentifierDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return assert.Equal(t, "email", in.AttributeName) &&
				assert.Equal(t, email, in.Value)
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge(func(in domain.FlowIssueChallengeInput, params domain.FlowPasskeyRegistrationChallengeParams) bool {
			return assert.Empty(t, params.UserID) &&
				assert.Equal(t, email, params.Username) &&
				assert.Equal(t, email, params.DisplayName)
		})).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	registerStep, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", registerStep.Step.Name)

	issued, err := w.sm.Process(t.Context(), def, registerStep.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
}

// TestFlowStateMachine_Process_PasskeyRegisterConflictPinsExistingUser covers
// the uniqueness race on a provisional registration: the verify transaction
// rolls back, and before routing user_already_exists the engine re-resolves
// the collected identifier so the existing user is pinned on the attempt —
// the downstream password step requires a persisted user factor.
func TestFlowStateMachine_Process_PasskeyRegisterConflictPinsExistingUser(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const mintedUserID = "user_prov01"
	const existingUserID = "user_existing01"
	w := newFlowTestWorld(t)
	def := passkeyRegisterAfterIdentifierDefinition()
	def.Steps[1].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "password"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{
		Name: "password",
		Actions: []domain.FlowStepAction{
			{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
		},
		Transitions: map[string]domain.FlowStepTransition{
			flowengine.FlowActionSubmit: {Target: "done"},
		},
	})

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	// Identify step: the email is unknown, so register mode continues.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyRegistrationChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: challengeID,
			UserID:      mintedUserID,
			Options:     []byte(registrationOpts),
		}, nil)
	// Verify leg loses the uniqueness race...
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskeyRegistration, nil)).
		Return("", domain.ErrUserAlreadyExists())
	// ...and the engine re-resolves the collected identifier to pin the
	// conflicting existing user on the attempt.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return assert.Equal(t, "email", in.AttributeName) &&
				assert.Equal(t, email, in.Value) &&
				assert.Equal(t, defaultSchemaURL, in.UserSchemaURL)
		})).
		Return(existingUserID, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	registerStep, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "register", registerStep.Step.Name)

	issued, err := w.sm.Process(t.Context(), def, registerStep.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	conflicted, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionPasskeyRegister,
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: challengeID,
			Method:      flowengine.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"conflicting"}`),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", conflicted.State.CurrentStep,
		"user_already_exists must follow the declared transition")
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, conflicted.State.CurrentPurpose,
		"the conflict flips back to login for verification")
	assert.Equal(t, existingUserID, conflicted.State.CollectedData.UserID,
		"the conflicting existing user must be pinned for the password step")
	assert.Nil(t, conflicted.State.PendingChallenge)
}

// TestFlowStateMachine_Process_PasskeyRegisterConflictUnrouted covers a
// register step without a user_already_exists transition. The conflict shows
// the error and drops the existing user, so a retried ceremony cannot
// register a passkey on that user.
func TestFlowStateMachine_Process_PasskeyRegisterConflictUnrouted(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	w := newFlowTestWorld(t)
	def := passkeyRegisterAfterIdentifierDefinition()
	rp := &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}}

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-2", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyRegistrationChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: "reg-1",
			UserID:      "user_prov01",
			Options:     []byte(registrationOpts),
		}, nil)
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskeyRegistration, nil)).
		Return("", domain.ErrUserAlreadyExists())
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_existing01", nil)
	// The retry runs on the new attempt with no user.
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge(func(in domain.FlowIssueChallengeInput, params domain.FlowPasskeyRegistrationChallengeParams) bool {
			return in.AttemptID == "attempt-2" && params.UserID == ""
		})).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: "reg-2",
			UserID:      "user_prov02",
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	registerStep, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	issued, err := w.sm.Process(t.Context(), def, registerStep.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: rp,
	})
	require.NoError(t, err)

	conflicted, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionPasskeyRegister,
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      flowengine.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"conflicting"}`),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", conflicted.State.CurrentStep)
	if assert.NotNil(t, conflicted.Step.Error) {
		assert.Equal(t, flowengine.FlowStepErrorUserAlreadyExists, *conflicted.Step.Error)
	}
	assert.Empty(t, conflicted.State.CollectedData.UserID)
	assert.Equal(t, "attempt-2", conflicted.State.AuthAttemptID)

	_, err = w.sm.Process(t.Context(), def, conflicted.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: rp,
	})
	require.NoError(t, err)
}

// TestFlowStateMachine_Process_PasskeyRegisterConflictOnSecondUniqueField
// covers a multi-unique schema losing the race on a non-identifier attribute:
// the sign-up email is fresh but the username is taken. Re-resolution must try
// every collected identifier-class field (every x-unique property resolves as
// one), not just the first, to pin the actually-conflicting owner.
func TestFlowStateMachine_Process_PasskeyRegisterConflictOnSecondUniqueField(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const username = "alice"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const existingUserID = "user_existing01"
	w := newFlowTestWorld(t)
	def := passkeyRegisterAfterUsernameAndEmailDefinition()
	def.Steps[1].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "password"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{
		Name: "password",
		Actions: []domain.FlowStepAction{
			{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
		},
		Transitions: map[string]domain.FlowStepTransition{
			flowengine.FlowActionSubmit: {Target: "done"},
		},
	})

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	// Identify step dispatches the first identifier field; unknown → register
	// mode continues.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyRegistrationChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: challengeID,
			UserID:      "user_prov01",
			Options:     []byte(registrationOpts),
		}, nil)
	// Verify loses the uniqueness race (on the email, not the username).
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskeyRegistration, nil)).
		Return("", domain.ErrUserAlreadyExists())
	// Re-resolution walks the identifier-class candidates in field order:
	// the username is fresh (rejected), the email resolves the owner. Both
	// are a sign-up's lookups, so the fresh one writes no failed check.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.AttributeName == "username" && in.Value == username && in.Register
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.AttributeName == "email" && in.Value == email && in.Register
		})).
		Return(existingUserID, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	registerStep, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email, "username": username},
	})
	require.NoError(t, err)
	require.Equal(t, "register", registerStep.Step.Name)

	issued, err := w.sm.Process(t.Context(), def, registerStep.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	conflicted, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionPasskeyRegister,
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: challengeID,
			Method:      flowengine.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"conflicting"}`),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", conflicted.State.CurrentStep)
	assert.Equal(t, existingUserID, conflicted.State.CollectedData.UserID,
		"the owner of the conflicting username must be pinned, not the fresh email's non-owner")
}

// TestFlowStateMachine_Process_PasskeyRegisterStaleChallengeUnsticks covers a
// ceremony outliving its 5-minute window inside a still-alive attempt: the
// stale verify must clear the pending challenge and render on the step, so
// the retry mints a fresh ceremony instead of re-emitting the stale one.
func TestFlowStateMachine_Process_PasskeyRegisterStaleChallengeUnsticks(t *testing.T) {
	t.Parallel()
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyRegistrationChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: "reg-1",
			UserID:      "user_prov01",
			Options:     []byte(registrationOpts),
		}, nil)
	w.authAttemptService.EXPECT().
		VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskeyRegistration, nil)).
		Return("", domain.ErrAuthAttemptStaleChallenge())
	// The retry after the stale render mints a fresh ceremony.
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyRegistrationChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{
			ChallengeID: "reg-2",
			UserID:      "user_prov01",
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	stale, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionPasskeyRegister,
		ChallengeResponse: &flowengine.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      flowengine.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"late"}`),
		},
	})
	require.NoError(t, err)
	require.NotNil(t, stale.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorPasskeyRegistrationInvalid, *stale.Step.Error)
	assert.Nil(t, stale.State.PendingChallenge,
		"a stale ceremony must be cleared so the retry can mint a fresh one")

	retried, err := w.sm.Process(t.Context(), def, stale.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskeyRegister,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, retried.State.PendingChallenge)
	assert.Equal(t, "reg-2", retried.State.PendingChallenge.ID)
}

// TestFlowStateMachine_Process_PasskeyOnPasswordStepSkipsPasswordCheck pins
// the passkey action as a non-submission of the password step's field.
// Browsers post the whole form, so the field rides along with the action, and
// both the value it carries and the value it lacks used to sink the leg
// before the WebAuthn prompt ever appeared: an empty box failed the
// required-field check, and a filled one was verified as a password. Neither
// is a password submission.
func TestFlowStateMachine_Process_PasskeyOnPasswordStepSkipsPasswordCheck(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "ch-1"
	const rpid = "example.com"

	// The password field is required, so an empty value trips "required". A
	// sign-in step carries no length rule, so a short value trips nothing of
	// its own. Each is the browser's form state, not something the user
	// submitted.
	passwordFields := map[string]string{
		"empty box":                  "",
		"a short value":              "short",
		"the identifier left behind": email,
	}

	for name, password := range passwordFields {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := purposeNavDefinition()

			w.schemaResolver.EXPECT().
				Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
				Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
				AnyTimes()
			w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
			w.authAttemptService.EXPECT().
				SubmitIdentifier(gomock.Any(), gomock.Any()).
				Return("user_alice", nil).
				Times(1)
			w.authAttemptService.EXPECT().
				SubmitPassword(gomock.Any(), gomock.Any()).
				Times(0)
			w.authAttemptService.EXPECT().
				IssueChallenge(gomock.Any(), issuesChallenge(func(in domain.FlowIssueChallengeInput, params domain.FlowPasskeyChallengeParams) bool {
					return params.RPID == rpid
				})).
				Return(domain.FlowIssuedChallenge{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil).
				Times(1)

			start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
				Definition:    def,
				Purpose:       domain.FlowDefinitionPurposeLogin,
				Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)

			afterIdentify, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
				Action: flowengine.FlowActionSubmit,
				Fields: map[string]any{"email": email},
			})
			require.NoError(t, err)
			require.Equal(t, "password", afterIdentify.State.CurrentStep)

			issued, err := w.sm.Process(t.Context(), def, afterIdentify.State, flowengine.FlowSubmitInput{
				Action:    flowengine.FlowActionPasskey,
				Fields:    map[string]any{"x-auth-methods#password": password},
				PasskeyRP: &flowengine.FlowPasskeyRP{RPID: rpid, Origins: []string{"https://example.com"}},
			})
			require.NoError(t, err)
			assert.Nil(t, issued.Step.Error, "the passkey action must not fail on the password field")
			require.NotNil(t, issued.Step.Challenge)
			assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
			assert.Equal(t, flowengine.FlowChallengeMethodPasskey, issued.Step.Challenge.Method)
			assert.Equal(t, "password", issued.State.CurrentStep, "the issue leg halts on the same step")
			assert.Empty(t, issued.State.CollectedData.AuthMethods[domain.AuthMethodPassword],
				"a field the leg does not submit must not be collected either")
		})
	}
}

// TestFlowStateMachine_Process_PasskeyStillIdentifies keeps the other half:
// the identifier is the one field a passkey login leg does consume, so it
// still reaches SubmitIdentifier and still answers to its own rules.
func TestFlowStateMachine_Process_PasskeyStillIdentifies(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "ch-1"
	const rpid = "example.com"
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.AttributeName == "email" && in.Value == email
		})).
		Return("user_alice", nil).
		Times(1)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[domain.FlowPasskeyChallengeParams](nil)).
		Return(domain.FlowIssuedChallenge{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil).
		Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: rpid, Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, "user_alice", issued.State.CollectedData.UserID,
		"the identifier a passkey leg carries still resolves the user")
}
