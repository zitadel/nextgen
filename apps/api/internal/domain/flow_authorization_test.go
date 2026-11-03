package domain_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
)

// fakeAuthorizer is the authorization server a flow that answers a request
// reports to: it says whether the user must consent, and records each answer.
type fakeAuthorizer struct {
	needsConsent bool
	answers      []domain.FlowAuthAnswer
	users        []string
}

func (f *fakeAuthorizer) NeedsConsent(context.Context, string, *domain.FlowAuthRequest, string) (bool, error) {
	return f.needsConsent, nil
}

func (f *fakeAuthorizer) Answer(_ context.Context, _ string, _ *domain.FlowAuthRequest, userID string, answer domain.FlowAuthAnswer) (string, error) {
	f.answers = append(f.answers, answer)
	f.users = append(f.users, userID)
	return answerURL(answer), nil
}

func answerURL(answer domain.FlowAuthAnswer) string {
	return fmt.Sprintf("http://127.0.0.1:5000/callback?answer=%d", answer)
}

func agentRequest() *domain.FlowAuthRequest {
	return &domain.FlowAuthRequest{
		ID:            "req1",
		BindingCookie: "__Host-_zauthz_req1",
		Client:        domain.FlowClient{ID: "https://agent.example/client.json", Name: "Agent", RedirectHost: "127.0.0.1:5000"},
		API:           domain.FlowAPI{Identifier: "https://zitadel.example.com/mcp", Name: "Zitadel MCP server"},
		Scope:         []string{"openid", "offline_access"},
		Record:        json.RawMessage(`{}`),
	}
}

// authorizingWorld is the flow test world with an authorization server, and
// alice's sign-in through loginDefinition expected: identifier, password and,
// when signedIn is false, nothing else.
func authorizingWorld(t *testing.T, authorizer *fakeAuthorizer) *flowTestWorld {
	t.Helper()
	w := newFlowTestWorld(t)
	w.sm.WithAuthorizer(authorizer)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_01TEST", nil)
	return w
}

func expectAliceSignsIn(w *flowTestWorld) {
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("user_alice", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any())
}

func expectHandoff(w *flowTestWorld) {
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{
		Token:     "handoff_01TEST",
		ExpiresAt: time.Unix(1700000060, 0).UTC(),
	}, nil)
}

var aliceCredentials = domain.FlowSubmitInput{
	Action: domain.FlowActionSubmit,
	Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "correct-horse-battery-staple"},
}

func startAuthorizing(t *testing.T, w *flowTestWorld, req *domain.FlowAuthRequest, sessionUser string) domain.FlowStepResult {
	t.Helper()
	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    loginDefinition(),
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		AuthRequest:   req,
		SessionUserID: sessionUser,
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	return start
}

func requireRedirectTo(t *testing.T, result domain.FlowStepResult, target string) {
	t.Helper()
	require.NotNil(t, result.Step)
	require.NotNil(t, result.Step.Complete, "step %q", result.Step.Name)
	assert.Equal(t, domain.FlowStepCompleteRedirect, *result.Step.Complete)
	require.NotNil(t, result.State.RedirectURI)
	assert.Equal(t, target, *result.State.RedirectURI)
}

// A flow that answers a request ends in a redirect to the client, though its
// definition's terminal step only shows, and keeps its handoff, so the page
// keeps the session before it leaves (ADR 081 §9).
func TestFlowStateMachine_AuthRequest_EndsInARedirectToTheClient(t *testing.T) {
	t.Parallel()
	authorizer := &fakeAuthorizer{}
	w := authorizingWorld(t, authorizer)
	expectAliceSignsIn(w)
	expectHandoff(w)

	start := startAuthorizing(t, w, agentRequest(), "")
	require.Equal(t, "credentials", start.Step.Name, "no one is signed in yet")
	result, err := w.sm.Process(t.Context(), loginDefinition(), start.State, aliceCredentials)
	require.NoError(t, err)

	requireRedirectTo(t, result, answerURL(domain.FlowAuthAllow))
	assert.Equal(t, "handoff_01TEST", result.HandoffToken)
	assert.Equal(t, []string{"user_alice"}, authorizer.users)
}

// A user who must consent sees the consent step once signed in, on reload
// too, and the flow answers what they choose (ADR 081 §11).
func TestFlowStateMachine_AuthRequest_AsksForConsentAfterSignIn(t *testing.T) {
	t.Parallel()
	for name, choice := range map[string]struct {
		action string
		answer domain.FlowAuthAnswer
	}{
		"accept": {domain.FlowActionAccept, domain.FlowAuthAllow},
		"deny":   {domain.FlowActionDeny, domain.FlowAuthDeny},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			authorizer := &fakeAuthorizer{needsConsent: true}
			w := authorizingWorld(t, authorizer)
			expectAliceSignsIn(w)
			expectHandoff(w)
			def := loginDefinition()

			start := startAuthorizing(t, w, agentRequest(), "")
			signedIn, err := w.sm.Process(t.Context(), def, start.State, aliceCredentials)
			require.NoError(t, err)
			require.Equal(t, domain.FlowStepNameConsent, signedIn.Step.Name)
			assert.Nil(t, signedIn.Step.Complete)
			assert.Empty(t, signedIn.HandoffToken, "the flow ends only with the user's answer")
			assert.Empty(t, authorizer.answers)
			assert.Equal(t, []domain.FlowAction{
				{Name: domain.FlowActionAccept, Kind: domain.FlowActionKindSubmit, TextKey: "consent.action.accept", Primary: true},
				{Name: domain.FlowActionDeny, Kind: domain.FlowActionKindNavigate, TextKey: "consent.action.deny"},
			}, signedIn.Step.Actions, "no back past the sign-in")
			assert.Equal(t, &domain.FlowStepConsent{
				API: domain.FlowAPI{Identifier: "https://zitadel.example.com/mcp", Name: "Zitadel MCP server"},
				Scopes: []domain.FlowConsentScope{
					{Name: "openid", TextKey: "scope.openid"},
					{Name: "offline_access", TextKey: "scope.offline_access"},
				},
			}, signedIn.Step.Consent)

			reloaded, err := w.sm.Render(t.Context(), def, signedIn.State)
			require.NoError(t, err)
			assert.Equal(t, domain.FlowStepNameConsent, reloaded.Step.Name, "a reload shows the step again")

			_, err = w.sm.Process(t.Context(), def, signedIn.State, domain.FlowSubmitInput{Action: domain.FlowActionSubmit})
			assert.ErrorIs(t, err, domain.ErrFlowInvalidAction(), "the step takes accept or deny")

			answered, err := w.sm.Process(t.Context(), def, signedIn.State, domain.FlowSubmitInput{Action: choice.action})
			require.NoError(t, err)
			requireRedirectTo(t, answered, answerURL(choice.answer))
			assert.Equal(t, "handoff_01TEST", answered.HandoffToken, "the user signed in either way")
			assert.False(t, answered.State.AwaitingConsent)
		})
	}
}

// With a live session the flow signs no one in: it answers at once for the
// session's user, under the consent step when they must consent, and ends
// without a handoff, since the browser keeps its session (ADR 081 §8).
func TestFlowStateMachine_AuthRequest_ALiveSessionAnswersAtOnce(t *testing.T) {
	t.Parallel()
	t.Run("nothing to ask", func(t *testing.T) {
		t.Parallel()
		authorizer := &fakeAuthorizer{}
		w := authorizingWorld(t, authorizer)

		start := startAuthorizing(t, w, agentRequest(), "user_bob")

		requireRedirectTo(t, start, answerURL(domain.FlowAuthAllow))
		assert.Empty(t, start.HandoffToken)
		assert.Equal(t, []string{"user_bob"}, authorizer.users)
	})
	t.Run("consent to ask", func(t *testing.T) {
		t.Parallel()
		authorizer := &fakeAuthorizer{needsConsent: true}
		w := authorizingWorld(t, authorizer)
		def := loginDefinition()

		start := startAuthorizing(t, w, agentRequest(), "user_bob")
		require.Equal(t, domain.FlowStepNameConsent, start.Step.Name)
		answered, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: domain.FlowActionAccept})
		require.NoError(t, err)

		requireRedirectTo(t, answered, answerURL(domain.FlowAuthAllow))
		assert.Empty(t, answered.HandoffToken)
		assert.Equal(t, []string{"user_bob"}, authorizer.users)
	})
}

// prompt=login signs the user in again, live session or not.
func TestFlowStateMachine_AuthRequest_PromptLoginSignsInAgain(t *testing.T) {
	t.Parallel()
	w := authorizingWorld(t, &fakeAuthorizer{})
	req := agentRequest()
	req.ForceLogin = true

	start := startAuthorizing(t, w, req, "user_bob")

	assert.Equal(t, "credentials", start.Step.Name)
	assert.Empty(t, start.State.CollectedData.UserID)
}

// prompt=none never shows a step: it answers at once, with the code, or with
// login_required or consent_required.
func TestFlowStateMachine_AuthRequest_PromptNoneShowsNoStep(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		sessionUser  string
		needsConsent bool
		answer       domain.FlowAuthAnswer
	}{
		"signed in":      {"user_bob", false, domain.FlowAuthAllow},
		"signed out":     {"", false, domain.FlowAuthLoginRequired},
		"consent to ask": {"user_bob", true, domain.FlowAuthConsentRequired},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w := authorizingWorld(t, &fakeAuthorizer{needsConsent: tc.needsConsent})
			req := agentRequest()
			req.NoInteraction = true

			start := startAuthorizing(t, w, req, tc.sessionUser)

			requireRedirectTo(t, start, answerURL(tc.answer))
			assert.Empty(t, start.HandoffToken)
		})
	}
}

// Without an authorization server, no flow carries a request.
func TestFlowStateMachine_AuthRequest_NeedsAnAuthorizer(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	_, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    loginDefinition(),
		Purpose:       domain.FlowDefinitionPurposeLogin,
		AuthRequest:   agentRequest(),
		UserSchemaURL: defaultSchemaURL,
	})

	assert.ErrorIs(t, err, domain.ErrFlowAuthRequestInvalid())
}

// The engine inserts the consent and account choice steps, so a definition
// cannot name a step after them, nor drop or replace them (ADR 081 §11).
func TestValidator_RefusesTheStepNamesTheEngineReserves(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	for _, name := range []string{domain.FlowStepNameConsent, domain.FlowStepNameAccountChoice} {
		t.Run(name, func(t *testing.T) {
			def := domain.FlowDefinition{
				ProjectID:     "p",
				Name:          "login",
				SchemaVersion: "1.0.0",
				UserSchema:    "https://tenant.com/schemas/idpw-user.json",
				Purposes: map[domain.FlowDefinitionPurpose]string{
					domain.FlowDefinitionPurposeLogin: "credentials",
				},
				Steps: []domain.FlowDefinitionStep{
					{
						Name:   "credentials",
						Fields: []domain.Field{"email", "x-auth-methods#password"},
						Actions: []domain.FlowStepAction{
							{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
						},
						Transitions: map[string]domain.FlowStepTransition{"submit": {Target: name}},
					},
					{Name: name, Complete: gu.Ptr(domain.FlowStepCompleteShow)},
				},
			}

			_, err := domain.ValidateFlowDefinition(schema, def)

			require.Error(t, err)
			assert.Contains(t, errorDetails(t, err), fmt.Sprintf("step name %q is reserved", name))
		})
	}
}
