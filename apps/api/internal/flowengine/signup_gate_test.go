package flowengine_test

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
)

// A step whose on_success spends the sign-up proof announces the gate on
// every entry point, read from the active definition without reading it again.
func TestSignupGate_OnSuccessThatSpendsTheProof(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(nil, nil)

	started, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.True(t, started.Step.SignupRequired, "start")

	defs := &definitionsByID{defs: map[string]*domain.FlowDefinition{def.ID: def}}
	rejected, err := w.sm.Process(t.Context(), defs, started.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{"email": "not-an-email", "x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error, "the step re-renders with its field error")
	assert.True(t, rejected.Step.SignupRequired, "process")
	assert.Equal(t, []string{def.ID}, defs.asked, "the gate reads the step from the definition the submission ran on")

	rendered, err := w.sm.Render(t.Context(), served(def), rejected.State)
	require.NoError(t, err)
	assert.True(t, rendered.Step.SignupRequired, "render")
}

// A pending passkey registration announces the gate when it creates its user.
// The challenge records that at issue, and one issued by an earlier request
// is confirmed with the attempt: a cookie replayed after the ceremony was
// superseded, or after the attempt is gone, carries a challenge the attempt
// no longer holds, and announces nothing.
func TestSignupGate_PendingPasskeyRegistration(t *testing.T) {
	t.Parallel()
	readFailed := errors.New("read failed")
	registration := func(provisional bool) *flowengine.PendingChallenge {
		return &flowengine.PendingChallenge{ID: "reg-1", Method: flowengine.ChallengeMethodPasskeyRegister, Options: []byte(`{}`), Provisional: provisional}
	}
	for _, tc := range []struct {
		name string
		// createsUser has the step's on_success create the user as well.
		createsUser bool
		pending     *flowengine.PendingChallenge
		// confirm is what the attempt answers; nil when it is not asked.
		confirm *bool
		readErr error
		gated   bool
	}{
		{name: "provisional registration", pending: registration(true), confirm: new(true), gated: true},
		{name: "superseded or gone at the attempt", pending: registration(true), confirm: new(false)},
		{name: "enrollment of a pinned user", pending: registration(false)},
		{name: "passkey sign-in", pending: &flowengine.PendingChallenge{ID: "pk-1", Method: flowengine.ChallengeMethodPasskey, Options: []byte(`{}`)}},
		{name: "no ceremony pending"},
		{name: "on_success creates the user too", createsUser: true, pending: registration(true), gated: true},
		{name: "read fails", pending: registration(true), confirm: new(false), readErr: readFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := passkeyRegisterDefinition()
			if tc.createsUser {
				def.Steps[0].OnSuccess = new(domain.FlowOnSuccessCreateUser)
			}
			w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(nil, nil)
			if tc.confirm != nil {
				w.authAttemptService.EXPECT().
					ProvisionalRegistration(gomock.Any(), testProjectID, "attempt-1", "reg-1").
					Return(*tc.confirm, tc.readErr)
			}
			state := &flowengine.State{
				ID:            "flow-1",
				ProjectID:     testProjectID,
				UserSchemaURL: defaultSchemaURL,
				Progress: flowengine.Progress{
					DefinitionID:   def.ID,
					Purpose:        domain.FlowDefinitionPurposeLogin,
					CurrentPurpose: domain.FlowDefinitionPurposeLogin,
					CurrentStep:    "register",
				},
				PendingChallenge: tc.pending,
				AuthAttemptID:    "attempt-1",
			}

			rendered, err := w.sm.Render(t.Context(), served(def), state)
			if tc.readErr != nil {
				require.ErrorIs(t, err, readFailed)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.gated, rendered.Step.SignupRequired)
		})
	}
}

// The submission that issues a registration announces what the issued
// challenge says without asking the attempt again; a later submission that
// resumes the pending ceremony asks, as a render does.
func TestSignupGate_IssuedPasskeyRegistration(t *testing.T) {
	t.Parallel()
	for _, provisional := range []bool{true, false} {
		t.Run(map[bool]string{true: "provisional", false: "enrollment"}[provisional], func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := passkeyRegisterDefinition()
			w.schemaResolver.EXPECT().
				Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
				Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
				AnyTimes()
			w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
			w.authAttemptService.EXPECT().
				IssueChallenge(gomock.Any(), issuesChallenge[flowengine.PasskeyRegistrationChallengeParams](nil)).
				Return(flowengine.IssuedChallenge{ChallengeID: "reg-1", UserID: "user_1", Options: []byte(`{}`), Provisional: provisional}, nil)

			started, err := w.sm.Start(t.Context(), flowengine.StartInput{
				Definition:    def,
				Purpose:       domain.FlowDefinitionPurposeLogin,
				Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)
			assert.False(t, started.Step.SignupRequired, "no ceremony is pending yet")

			submit := flowengine.SubmitInput{
				Action:    flowengine.ActionPasskeyRegister,
				PasskeyRP: &flowengine.PasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
			}
			issued, err := w.sm.Process(t.Context(), served(def), started.State, submit)
			require.NoError(t, err)
			require.NotNil(t, issued.Step.Challenge)
			assert.Equal(t, provisional, issued.State.PendingChallenge.Provisional, "the cookie keeps what the issued challenge said")
			assert.Equal(t, provisional, issued.Step.SignupRequired, "issue leg")

			if provisional {
				w.authAttemptService.EXPECT().
					ProvisionalRegistration(gomock.Any(), testProjectID, "attempt-1", "reg-1").
					Return(true, nil)
			}
			resumed, err := w.sm.Process(t.Context(), served(def), issued.State, submit)
			require.NoError(t, err)
			require.NotNil(t, resumed.Step.Challenge)
			assert.Equal(t, provisional, resumed.Step.SignupRequired, "resume leg")
		})
	}
}

// The pending challenge's Provisional rides the sealed state.
func TestSignupGate_PendingChallengeProvisionalRoundTrips(t *testing.T) {
	t.Parallel()
	state := &flowengine.State{PendingChallenge: &flowengine.PendingChallenge{
		ID:          "reg-1",
		Method:      flowengine.ChallengeMethodPasskeyRegister,
		IssuedAt:    time.Unix(1700000000, 0).UTC(),
		Provisional: true,
	}}
	raw, err := json.Marshal(state)
	require.NoError(t, err)
	var decoded flowengine.State
	require.NoError(t, json.Unmarshal(raw, &decoded))
	assert.Equal(t, state.PendingChallenge, decoded.PendingChallenge)
}
