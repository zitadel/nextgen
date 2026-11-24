package flowengine_test

import (
	"encoding/json"
	"errors"
	"maps"
	"strings"
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

// startSSOStepFlow starts a flow on the sso step and returns its state.
// The one render expectation it sets is consumed by Start; a test that
// re-renders adds its own.
func startSSOStepFlow(t *testing.T, w *flowTestWorld, def *domain.FlowDefinition) *flowengine.FlowState {
	t.Helper()
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}, {ID: "github", Name: "GitHub"}}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	return start.State
}

var ssoSubmitReturn = &domain.FlowSSOReturn{
	RedirectURI:  "https://auth.example.com/__nextgen/idp/google/callback",
	ReturnTarget: "https://auth.example.com/login?flow=flow-1",
}

func TestFlowStateMachine_Process_SSO_EmitsRedirectStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()
	state := startSSOStepFlow(t, w, def)
	// Picking a provider abandons a ceremony the step had pending.
	state.PendingChallenge = &flowengine.FlowPendingChallenge{ID: "ch-1", Method: flowengine.FlowChallengeMethodPasskey}

	w.ssoRedirects.EXPECT().
		Issue(gomock.Any(), flowengine.FlowIssueSSORedirectInput{
			ProjectID:     testProjectID,
			AttemptID:     "attempt-1",
			ProviderSlug:  "google",
			FlowSSOReturn: *ssoSubmitReturn,
		}).
		Return(flowengine.FlowSSORedirectOutput{
			RedirectURL:  "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
			BindingNonce: "nonce-1",
		}, nil)

	result, err := w.sm.Process(t.Context(), def, state, flowengine.FlowSubmitInput{
		Action:      domain.FlowActionSSO,
		SSOProvider: &flowengine.FlowSSOProviderRef{ID: "google"},
		SSOReturn:   ssoSubmitReturn,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, flowengine.FlowStepNameSSORedirect, result.Step.Name)
	assert.Equal(t, "sso.redirect.title", result.Step.Texts.TitleKey)
	require.NotNil(t, result.Step.RedirectURL)
	assert.Equal(t, "https://accounts.google.com/o/oauth2/v2/auth?state=abc", *result.Step.RedirectURL)
	assert.Empty(t, result.Step.Fields, "the redirect step collects nothing")
	assert.Empty(t, result.Step.Actions)
	assert.Equal(t, "nonce-1", result.SSOBindingNonce)
	assert.Equal(t, "credentials", result.State.CurrentStep, "the flow waits on the step the provider was picked from")
	assert.Equal(t, time.Unix(1700000000, 0).UTC(), result.State.IssuedAt, "the re-sealed cookie starts a fresh window for the external leg")
	assert.Nil(t, result.State.PendingChallenge, "the abandoned ceremony is dropped")
	assert.Nil(t, result.Step.Challenge, "a cleared challenge is not rendered")
}

func TestFlowStateMachine_Process_SSO_InvalidSubmissions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   flowengine.FlowSubmitInput
	}{
		{
			name: "provider not offered on the step",
			in: flowengine.FlowSubmitInput{
				Action:      domain.FlowActionSSO,
				SSOProvider: &flowengine.FlowSSOProviderRef{ID: "okta"},
				SSOReturn:   ssoSubmitReturn,
			},
		},
		{
			name: "sso action without a provider",
			in: flowengine.FlowSubmitInput{
				Action:    domain.FlowActionSSO,
				SSOReturn: ssoSubmitReturn,
			},
		},
		{
			name: "provider on another action",
			in: flowengine.FlowSubmitInput{
				Action:      flowengine.FlowActionSubmit,
				SSOProvider: &flowengine.FlowSSOProviderRef{ID: "google"},
				SSOReturn:   ssoSubmitReturn,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := ssoStepDefinition()
			state := startSSOStepFlow(t, w, def)

			_, err := w.sm.Process(t.Context(), def, state, tt.in)
			require.ErrorIs(t, err, domain.ErrFlowInvalidAction())
		})
	}
}

func TestFlowStateMachine_Process_SSO_ReturnParamsMissing(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()
	state := startSSOStepFlow(t, w, def)

	_, err := w.sm.Process(t.Context(), def, state, flowengine.FlowSubmitInput{
		Action:      domain.FlowActionSSO,
		SSOProvider: &flowengine.FlowSSOProviderRef{ID: "google"},
	})
	require.ErrorIs(t, err, domain.ErrFlowIntegrity())
}

func TestFlowStateMachine_Process_SSO_ProviderUnavailableReRendersStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()
	state := startSSOStepFlow(t, w, def)
	// The re-render after a provider outage drops a pending ceremony too.
	state.PendingChallenge = &flowengine.FlowPendingChallenge{ID: "ch-1", Method: flowengine.FlowChallengeMethodPasskey}
	w.ssoRedirects.EXPECT().Issue(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowSSORedirectOutput{}, domain.ErrFlowSSOUnavailable(errors.New("discovery timed out")))
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}, {ID: "github", Name: "GitHub"}}, nil)

	result, err := w.sm.Process(t.Context(), def, state, flowengine.FlowSubmitInput{
		Action:      domain.FlowActionSSO,
		SSOProvider: &flowengine.FlowSSOProviderRef{ID: "google"},
		SSOReturn:   ssoSubmitReturn,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorSSOUnavailable, *result.Step.Error)
	assert.Len(t, result.Step.SSOProviders, 2, "the other providers stay on offer")
	assert.Nil(t, result.Step.RedirectURL)
	assert.Empty(t, result.SSOBindingNonce)
	assert.Nil(t, result.State.PendingChallenge, "the abandoned ceremony is dropped")
	assert.Nil(t, result.Step.Challenge, "a cleared challenge is not rendered")
}

func TestFlowStateMachine_Process_SSO_IssueErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		issue   error
		wantErr error
	}{
		{
			// A slug the render dropped is one the client was never offered,
			// so a submission naming it is an invalid action rather than a
			// provider outage.
			name:    "connection gone is an invalid action",
			issue:   domain.ErrIDPConnectionNotFound(),
			wantErr: domain.ErrFlowInvalidAction(),
		},
		{
			name:    "attempt error passes through",
			issue:   domain.ErrAuthAttemptAlreadyHandedOff(),
			wantErr: domain.ErrAuthAttemptAlreadyHandedOff(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := ssoStepDefinition()
			state := startSSOStepFlow(t, w, def)
			w.ssoRedirects.EXPECT().Issue(gomock.Any(), gomock.Any()).Return(flowengine.FlowSSORedirectOutput{}, tt.issue)

			_, err := w.sm.Process(t.Context(), def, state, flowengine.FlowSubmitInput{
				Action:      domain.FlowActionSSO,
				SSOProvider: &flowengine.FlowSSOProviderRef{ID: "google"},
				SSOReturn:   ssoSubmitReturn,
			})
			require.ErrorIs(t, err, tt.wantErr)
		})
	}
}

// ssoStepDefinition offers two providers on the signup step, routed to
// done on sso_authenticated as the validator requires of a step with sso_providers.
func ssoStepDefinition() *domain.FlowDefinition {
	def := signupDefinition()
	def.Steps[0].SSOProviders = []string{"google", "github"}
	def.Steps[0].Transitions["sso_authenticated"] = domain.FlowStepTransition{Target: "done"}
	return def
}

func TestFlowStateMachine_Start_RendersSSOProvidersInStepOrder(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	google := domain.FlowSSOProvider{ID: "google", Name: "Google", Template: "google"}
	github := domain.FlowSSOProvider{ID: "github", Name: "GitHub", Template: "github"}
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{google, github}, nil)

	result, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, []domain.FlowSSOProvider{google, github}, result.Step.SSOProviders)
	assert.True(t, containsFieldName(result.Step.Fields, "email"), "the step's inputs render alongside the providers")
}

func TestFlowStateMachine_Start_AsksForTheSSODescriptionOnAStepOfferingProviders(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google", Template: "google"}}, nil)

	result, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    ssoStepDefinition(),
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, "credentials.description.sso", result.Step.Texts.DescriptionKey)
}

// The key follows the providers the step renders, not the ones it declares: a
// listed provider whose connection is gone shows no button, so no wording for one.
func TestFlowStateMachine_Start_KeepsThePlainDescriptionWhenNoListedProviderResolves(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
		Return(nil, nil)

	result, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    ssoStepDefinition(),
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, "credentials.description", result.Step.Texts.DescriptionKey)
}

func TestFlowStateMachine_Start_KeepsThePlainDescriptionWhenNoProviderIsOffered(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	result, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    signupDefinition(),
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, "credentials.description", result.Step.Texts.DescriptionKey)
}

// Providers are resolved on every render, not once per flow, so an edit to
// a connection's display name shows on the next page load. A validation
// error is the cheapest second render to prove it on.
func TestFlowStateMachine_Process_ReRenderResolvesSSOProvidersAgain(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	gomock.InOrder(
		w.ssoProviders.EXPECT().
			Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
			Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google", Template: "google"}}, nil),
		w.ssoProviders.EXPECT().
			Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
			Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google Workspace", Template: "google"}}, nil),
	)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	require.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, []domain.FlowSSOProvider{{ID: "google", Name: "Google Workspace", Template: "google"}}, result.Step.SSOProviders)
}

func TestFlowStateMachine_Start_SSOProviderResolverErrorFailsRender(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
		Return(nil, errors.New("connection store unavailable"))

	_, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.ErrorContains(t, err, "connection store unavailable")
}

// ssoSchemaContent is the schema behind [ssoRenderWorld]: email and username
// are project-unique and badge is team-unique, and the collision check probes
// all three; account.handle is a nested unique leaf; employee_id is a unique
// number; age is a type union no step renders; locale and address carry rules
// a step field does not check.
const ssoSchemaContent string = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true }, "passkey": { "enabled": true } },
		"x-identifier": "email",
		"required": ["email", "username", "given_name", "family_name", "badge"],
		"properties": {
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-unique": "project" },
			"username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-unique": "project" },
			"given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
			"family_name": { "type": "string", "minLength": 1, "maxLength": 200 },
			"badge":       { "type": "string", "x-unique": "team" },
			"employee_id": { "type": "integer", "x-unique": "project" },
			"age":         { "type": ["string", "integer"] },
			"locale":      { "type": "string", "enum": ["en", "de", "fr"] },
			"homepage":    { "type": "string", "format": "uri" },
			"account": {
				"type": "object",
				"properties": { "handle": { "type": "string", "x-unique": "project" } }
			},
			"address": {
				"type": "object",
				"required": ["country"],
				"properties": {
					"street_address": { "type": "string" },
					"locality":       { "type": "string" },
					"country":        { "type": "string", "enum": ["DE", "CH"] }
				}
			}
		}
	}`

// ssoRenderWorld is a test world sitting on the sso step of
// [ssoStepDefinition], with the schema and the provider list resolving on
// every render.
func ssoRenderWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState) {
	t.Helper()
	return ssoRenderWorldWithSchema(t, ssoSchemaContent)
}

// ssoRenderWorldWithSchema is [ssoRenderWorld] on another user schema.
func ssoRenderWorldWithSchema(t *testing.T, schema string) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState) {
	t.Helper()
	w := newFlowTestWorld(t)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, schema), nil).
		AnyTimes()
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}}, nil).
		AnyTimes()
	state := &flowengine.FlowState{
		ID:            "flow-1",
		ProjectID:     testProjectID,
		UserSchemaURL: defaultSchemaURL,
		FlowProgress: flowengine.FlowProgress{
			DefinitionID:   "def-signup",
			Purpose:        domain.FlowDefinitionPurposeRegister,
			CurrentPurpose: domain.FlowDefinitionPurposeRegister,
			CurrentStep:    "credentials",
		},
		AuthAttemptID: "att-1",
	}
	return w, ssoStepDefinition(), state
}

// expectParked makes LoadParked hand back parked for the world's attempt.
func (w *flowTestWorld) expectParked(parked *flowengine.FlowSSOParkedIdentity, err error) {
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), flowengine.FlowSSOLoadInput{
			ProjectID:     testProjectID,
			AttemptID:     "att-1",
			UserSchemaURL: defaultSchemaURL,
		}).
		Return(parked, err)
}

func linkedParked() *flowengine.FlowSSOParkedIdentity {
	return &flowengine.FlowSSOParkedIdentity{
		CheckID:      "ch-1",
		ConnectionID: "idp-1",
		Subject:      "sub-1",
		Link:         &flowengine.FlowSSOLinkedUser{LinkID: "idplink-1", UserID: "user-1"},
	}
}

func TestFlowStateMachine_Render_SSOReplayGuardSkipsResolution(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.SSOResolvedCheckID = "ch-1"
	// The engine hands its guard to the service, which skips the resolved row.
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), flowengine.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(nil, nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Empty(t, result.HandoffToken)
	assert.False(t, result.Reseal)
}

func TestFlowStateMachine_Render_NoParkedIdentityRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(nil, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.SSOResolvedCheckID)
	assert.False(t, result.Reseal)
	assert.Zero(t, result.State.IssuedAt, "a plain render does not refresh IssuedAt")
}

func TestFlowStateMachine_Render_SSORestartRequiredPropagates(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(nil, domain.ErrFlowRestartRequired())

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// The attempt read on every render also ends a flow whose attempt is dead,
// on a step that offers no sso_providers too.
func TestFlowStateMachine_Render_DeadAttemptRestartsStepWithoutSSO(t *testing.T) {
	t.Parallel()
	w, _, state := ssoRenderWorld(t)
	w.expectParked(nil, domain.ErrFlowRestartRequired())

	_, err := w.sm.Render(t.Context(), signupDefinition(), state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

func TestFlowStateMachine_Render_SSOCreationDisabledRendersStepError(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", ConnectionID: "idp-1", Subject: "sub-1", CreationDisabled: true}, nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorSSOCreationDisabled, *result.Step.Error)
	assert.True(t, containsFieldName(result.Step.Fields, "email"), "the step keeps its inputs")
	assert.Empty(t, result.HandoffToken)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

func TestFlowStateMachine_Render_SSOParkedErrorRendersStepError(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", ErrorKey: flowengine.FlowStepErrorSSOCancelled}, nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorSSOCancelled, *result.Step.Error)
	assert.True(t, containsFieldName(result.Step.Fields, "email"), "the step keeps its inputs")
	assert.Empty(t, result.HandoffToken)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

// unlinkedParked is an identity with no link under `creation: auto`.
func unlinkedParked(claims map[string]any, verified map[string]bool) *flowengine.FlowSSOParkedIdentity {
	return &flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", ConnectionID: "idp-1", Subject: "sub-1", Claims: claims, Verified: verified}
}

// completeClaims carries every required property of ssoSchemaContent, the
// x-unique ones verified.
func completeClaims() (map[string]any, map[string]bool) {
	return map[string]any{
			"email":       "alice@example.com",
			"username":    "alice",
			"given_name":  "Alice",
			"family_name": "Liddell",
			"badge":       "b-7",
		}, map[string]bool{
			"email":    true,
			"username": true,
			"badge":    true,
		}
}

// withSSOOutcomeSteps routes the two creation outcomes to their own steps.
func withSSOOutcomeSteps(def *domain.FlowDefinition) *domain.FlowDefinition {
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "sso-conflict"}
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeSSOUserNotFound] = domain.FlowStepTransition{Target: "sso-register"}
	def.Steps = append(def.Steps,
		domain.FlowDefinitionStep{Name: "sso-conflict", Fields: []domain.Field{"email"}},
		domain.FlowDefinitionStep{Name: "sso-register", Fields: []domain.Field{"email", "username"}},
	)
	return def
}

// expectOwner answers one read-only collision lookup; "" is no owner.
func (w *flowTestWorld) expectOwner(attribute, value, userID string) *flowenginemock.MockFlowSSOIdentityServiceFindUniqueOwnerCall {
	return w.ssoIdentities.EXPECT().
		FindUniqueOwner(gomock.Any(), testProjectID, defaultSchemaURL, attribute, value).
		Return(userID, nil)
}

// expectBindCollision answers the bind of a found owner by user id.
func (w *flowTestWorld) expectBindCollision(userID string, err error) *flowenginemock.MockFlowSSOIdentityServiceBindCollisionCall {
	return w.ssoIdentities.EXPECT().
		BindCollision(gomock.Any(), flowengine.FlowSSOBindInput{ProjectID: testProjectID, AttemptID: "att-1", CheckID: "ch-1", UserID: userID}).
		Return(err)
}

func TestFlowStateMachine_Render_SSOCollisionRoutesUserAlreadyExists(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com", "username": "alice"}, map[string]bool{"email": true}), nil)
	gomock.InOrder(
		w.expectOwner("email", "alice@example.com", ""),
		w.expectOwner("username", "alice", "user-9"),
		w.expectBindCollision("user-9", nil),
	)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "user-9", result.State.CollectedData.UserID)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

func TestFlowStateMachine_Render_SSOCollisionFlipsRegisterToLogin(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, state.CurrentPurpose)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose)
	require.NotNil(t, result.Step.Notice, "the sign-up continues as a sign-in, so the step says why")
	assert.Equal(t, flowengine.FlowStepNoticeUserAlreadyExists, *result.Step.Notice)
}

// The attempt already carries another user, or it expired or was handed off:
// the bind refuses, and the flow starts over.
func TestFlowStateMachine_Render_SSOCollisionBindOnDeadAttemptRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", domain.ErrFlowRestartRequired())
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// The claim belongs to a user of another schema: the flow cannot continue
// with that user, so it starts over without binding or creating anyone.
func TestFlowStateMachine_Render_SSOCollisionOwnerOfAnotherSchemaRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.ssoIdentities.EXPECT().
		FindUniqueOwner(gomock.Any(), testProjectID, defaultSchemaURL, "email", "alice@example.com").
		Return("", domain.ErrSSOOwnerOtherSchema)
	w.ssoIdentities.EXPECT().BindCollision(gomock.Any(), gomock.Any()).Times(0)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// A provider claim that fails the schema (too long, bad format) cannot create
// a user unattended. One the user may edit is collected for the user to fix;
// a verified unique one the user may not change, so the entry step shows that
// no user can be created, and nothing is collected.
func TestFlowStateMachine_Render_SSOInvalidClaim(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("a", 65)
	for name, tc := range map[string]struct {
		edit     func(claims map[string]any, verified map[string]bool)
		probes   int
		create   bool
		wantStep string
		wantErr  string
	}{
		"claim the user may edit": {
			edit:     func(map[string]any, map[string]bool) {},
			probes:   3,
			create:   true,
			wantStep: "sso-register",
		},
		"unverified unique claim": {
			edit: func(claims map[string]any, verified map[string]bool) {
				claims["username"] = long
				verified["username"] = false
			},
			probes:   3,
			wantStep: "sso-register",
		},
		"verified unique claim": {
			edit:     func(claims map[string]any, _ map[string]bool) { claims["username"] = long },
			probes:   3,
			wantStep: "credentials",
			wantErr:  flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		"verified unique claim failing its format": {
			edit:     func(claims map[string]any, _ map[string]bool) { claims["email"] = "not-an-email" },
			probes:   3,
			wantStep: "credentials",
			wantErr:  flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		"leaf of a verified unique object": {
			edit: func(claims map[string]any, verified map[string]bool) {
				claims["account"] = map[string]any{"handle": 42}
				verified["account"] = true
			},
			probes:   4,
			wantStep: "credentials",
			wantErr:  flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		// The user may edit a leaf that is not unique.
		"leaf of a verified object that is not unique": {
			edit: func(claims map[string]any, verified map[string]bool) {
				claims["address"] = map[string]any{"country": "Germany"}
				verified["address"] = true
			},
			probes:   3,
			wantStep: "sso-register",
		},
		// The collection step leaves out a key the schema does not define.
		"key a verified object has beyond the schema": {
			edit: func(claims map[string]any, verified map[string]bool) {
				claims["account"] = map[string]any{"handle": "ali", "id": "g-123"}
				verified["account"] = true
			},
			probes:   4,
			create:   true,
			wantStep: "sso-register",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			def = withSSOOutcomeSteps(def)
			claims, verified := completeClaims()
			tc.edit(claims, verified)
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(tc.probes)
			if tc.create {
				w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrUserInvalid())
			}

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, tc.wantStep, result.Step.Name)
			if tc.wantErr == "" {
				assert.Nil(t, result.Step.Error)
			} else {
				require.NotNil(t, result.Step.Error)
				assert.Equal(t, tc.wantErr, *result.Step.Error)
			}
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
		})
	}
}

func TestFlowStateMachine_Render_SSOAutoCreateRoutesAuthenticated(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.expectOwner("badge", "b-7", "")
	w.expectOwner("email", "alice@example.com", "")
	w.expectOwner("username", "alice", "")
	w.ssoIdentities.EXPECT().
		CreateLinked(gomock.Any(), flowengine.FlowSSOCreateInput{
			ProjectID:     testProjectID,
			AttemptID:     "att-1",
			CheckID:       "ch-1",
			UserSchemaURL: defaultSchemaURL,
			ConnectionID:  "idp-1",
			Subject:       "sub-1",
			Attributes:    claims,
		}).
		Return("user-new", nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), flowengine.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
		Return(flowengine.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "done", result.Step.Name)
	assert.Equal(t, "handoff-1", result.HandoffToken)
	assert.Equal(t, "user-new", result.State.CollectedData.UserID)
	assert.True(t, result.Reseal)
}

// As after create_user, the step that created the user offers no back, even
// when sso_authenticated leads to a non-terminal step.
func TestFlowStateMachine_Render_SSOAutoCreateClearsBackStack(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = domain.FlowStepTransition{Target: "enroll"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{Name: "enroll", Fields: []domain.Field{"email"}})
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(3)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("user-new", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "enroll", result.Step.Name)
	assert.Equal(t, "user-new", result.State.CollectedData.UserID)
	assert.Empty(t, result.State.BackStack)
}

// Complete claims on a step that cannot route sso_authenticated create
// nothing: the step shows the provider as unavailable, and the row stays
// parked.
func TestFlowStateMachine_Render_SSOUnroutableTransitionDoesNotCreate(t *testing.T) {
	t.Parallel()
	for name, transition := range unroutableSSOTransitions() {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			setSSOAuthenticatedTransition(def, transition)
			claims, verified := completeClaims()
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.expectOwner("badge", "b-7", "")
			w.expectOwner("email", "alice@example.com", "")
			w.expectOwner("username", "alice", "")
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, flowengine.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
			assert.True(t, result.Reseal)
		})
	}
}

// Another sign-in took a unique attribute between the probe and the insert:
// the probe runs once more and binds the winner.
func TestFlowStateMachine_Render_SSOCreateUniqueRaceFallsThroughToCollision(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	gomock.InOrder(
		w.expectOwner("badge", "b-7", ""),
		w.expectOwner("email", "alice@example.com", ""),
		w.expectOwner("username", "alice", ""),
		w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrUserAlreadyExists()),
		w.expectOwner("badge", "b-7", ""),
		w.expectOwner("email", "alice@example.com", "user-9"),
		w.expectBindCollision("user-9", nil),
	)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "user-9", result.State.CollectedData.UserID)
}

// The race was lost on the subject (or the owner went away again): no
// candidate binds, so the identity falls back to collection.
func TestFlowStateMachine_Render_SSOCreateUniqueRaceWithoutOwnerRoutesUserNotFound(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(6)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrUserAlreadyExists())

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
	assert.Empty(t, result.State.CollectedData.UserID)
}

// Collection is the fallback: nothing is created, the parked row stays for
// the registration step to prefill from, and login flips to register.
func TestFlowStateMachine_Render_SSOMissingRequiredRoutesUserNotFound(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CurrentPurpose = domain.FlowDefinitionPurposeLogin
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, map[string]bool{"email": true}), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID, "the row stays, so the guard keeps it from resolving again")
	assert.True(t, result.Reseal, "the guard reaches the cookie only through a re-seal")
}

// A required unique claim the provider did not verify could take over
// someone's address, so it is collected instead of trusted.
func TestFlowStateMachine_Render_SSOUnverifiedRequiredUniqueRoutesUserNotFound(t *testing.T) {
	t.Parallel()
	// The rule holds for every scope.
	for _, unverified := range []string{"email", "badge"} {
		t.Run(unverified, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			def = withSSOOutcomeSteps(def)
			claims, verified := completeClaims()
			verified[unverified] = false
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.expectOwner("badge", "b-7", "")
			w.expectOwner("email", "alice@example.com", "")
			w.expectOwner("username", "alice", "")
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "sso-register", result.Step.Name)
		})
	}
}

// The new user has no team, so a team-unique value of a user with no team
// collides with it as a project-unique value does, and binds that user. The
// lookup asks only rows with no team, so a user of a team is never bound.
func TestFlowStateMachine_Render_SSOTeamUniqueClaimBindsOwnerWithoutTeam(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	gomock.InOrder(
		w.expectOwner("badge", "b-7", "user-9"),
		w.expectBindCollision("user-9", nil),
	)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "user-9", result.State.CollectedData.UserID)
}

// A step that does not route the outcome re-renders with the outcome's
// localized error, as a handler diversion does.
func TestFlowStateMachine_Render_SSOOutcomeUnwiredRendersStepError(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "")

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorSSOUserNotFound, *result.Step.Error)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
}

// The validator does not require user_already_exists on a step that offers
// sso_providers. Without a usable one, the owner the probe found is not
// bound: the step shows the provider as unavailable, the row stays parked,
// and the guard keeps a reload from repeating it.
func TestFlowStateMachine_Render_SSOCollisionUnroutableDoesNotBind(t *testing.T) {
	t.Parallel()
	action := domain.Switch
	for name, transition := range map[string]*domain.FlowStepTransition{
		"missing":     nil,
		"with action": {Target: "other-flow", Action: &action},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			if transition != nil {
				def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = *transition
			}
			w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
			w.expectOwner("email", "alice@example.com", "user-9")
			w.ssoIdentities.EXPECT().BindCollision(gomock.Any(), gomock.Any()).Times(0)
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, flowengine.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
		})
	}
}

// A purpose on user_already_exists starts that purpose fresh, as it does for
// a typed collision: the bound user is dropped with a new attempt, and the
// flow continues on the purpose's entry step instead of getting stuck.
func TestFlowStateMachine_Render_SSOCollisionWithPurposeStartsThatPurposeFresh(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	register := domain.FlowDefinitionPurposeRegister
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "credentials", Purpose: &register}
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att-2", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Equal(t, "att-2", result.State.AuthAttemptID)
}

// unroutableSSOTransitions are sso_authenticated transitions a stored
// definition can carry but the engine cannot take with the bound user, keyed
// by case name. nil removes the transition.
func unroutableSSOTransitions() map[string]*domain.FlowStepTransition {
	register := domain.FlowDefinitionPurposeRegister
	action := domain.Switch
	return map[string]*domain.FlowStepTransition{
		"missing":      nil,
		"with purpose": {Target: "done", Purpose: &register},
		"with action":  {Target: "other-flow", Action: &action},
	}
}

func setSSOAuthenticatedTransition(def *domain.FlowDefinition, transition *domain.FlowStepTransition) {
	delete(def.Steps[0].Transitions, domain.FlowImplicitOutcomeSSOAuthenticated)
	if transition != nil {
		def.Steps[0].Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = *transition
	}
}

// A stored definition is validated only on write. When its sso_authenticated
// transition cannot route, the attempt is not bound: the step shows the
// provider as unavailable, and the guard keeps a reload from repeating it.
func TestFlowStateMachine_Render_SSOUnroutableTransitionDoesNotBind(t *testing.T) {
	t.Parallel()
	for name, transition := range unroutableSSOTransitions() {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			setSSOAuthenticatedTransition(def, transition)
			w.expectParked(linkedParked(), nil)
			w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, flowengine.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
		})
	}
}

// An earlier bind committed but the current step cannot take the outcome: the
// step shows the provider as unavailable, and the attempt keeps its id and its
// user.
func TestFlowStateMachine_Render_SSOUnroutableTransitionDoesNotRetryHandoff(t *testing.T) {
	t.Parallel()
	for name, transition := range unroutableSSOTransitions() {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			setSSOAuthenticatedTransition(def, transition)
			w.expectParked(&flowengine.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, flowengine.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "att-1", result.State.AuthAttemptID)
			assert.False(t, result.Reseal)
		})
	}
}

func TestFlowStateMachine_Render_SSOBindOnForeignUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(linkedParked(), nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Return(domain.ErrFlowRestartRequired())
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID, "nothing is recorded for the foreign user")
	assert.Equal(t, "credentials", state.CurrentStep)
}

func TestFlowStateMachine_Render_SSOBoundAttemptWithRecordedUserRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.CollectedData.UserID = "u1"
	w.expectParked(&flowengine.FlowSSOParkedIdentity{BoundUserID: "u1"}, nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Empty(t, result.HandoffToken)
}

// expectStaleBind makes the bind of linkedParked find its row gone, and the
// second read of the attempt hand back parked.
func (w *flowTestWorld) expectStaleBind(parked *flowengine.FlowSSOParkedIdentity, err error) {
	w.expectParked(linkedParked(), nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Return(domain.ErrSSOStateInvalid())
	w.expectParked(parked, err)
}

// The winner settled the row and handed off: this response must not reseal a
// cookie over the winner's.
func TestFlowStateMachine_Render_SSOStaleBindAfterHandoffRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectStaleBind(nil, domain.ErrFlowRestartRequired())
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// A new ceremony replaced the row: the step renders, so the flow and its
// cookie stay usable for that ceremony.
func TestFlowStateMachine_Render_SSOStaleBindOnReplacedRowRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectStaleBind(nil, nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Empty(t, result.HandoffToken)
}

// Under creation auto the create's own delete can find the row gone. A row a
// new ceremony replaced shows the step with no outcome and records no user.
// The collision case is TestFlowStateMachine_Render_SSOCollisionStaleRowBindsNothing.
func TestFlowStateMachine_Render_SSOStaleParkedRowProvisioningRendersStep(t *testing.T) {
	t.Parallel()
	for name, wire := range map[string]func(w *flowTestWorld){
		"create": func(w *flowTestWorld) {
			claims, verified := completeClaims()
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(3)
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrSSOStateInvalid())
			w.expectParked(nil, nil)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			def = withSSOOutcomeSteps(def)
			wire(w)
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			assert.Nil(t, result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.False(t, result.Reseal)
		})
	}
}

// ssoHandoffPaths are the ways a render reaches the handoff: its own bind or
// creation, or a bind an earlier request committed.
var ssoHandoffPaths = []struct {
	name        string
	expect      func(w *flowTestWorld)
	wantCheckID string
}{
	{
		name: "own bind",
		expect: func(w *flowTestWorld) {
			w.expectParked(linkedParked(), nil)
			w.ssoIdentities.EXPECT().
				BindLinked(gomock.Any(), flowengine.FlowSSOBindInput{
					ProjectID:    testProjectID,
					AttemptID:    "att-1",
					CheckID:      "ch-1",
					UserID:       "user-1",
					ConnectionID: "idp-1",
					LinkID:       "idplink-1",
				}).
				Return(nil)
		},
		wantCheckID: "ch-1",
	},
	{
		name: "own creation",
		expect: func(w *flowTestWorld) {
			claims, verified := completeClaims()
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.expectOwner("badge", "b-7", "")
			w.expectOwner("email", "alice@example.com", "")
			w.expectOwner("username", "alice", "")
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("user-1", nil)
		},
		wantCheckID: "ch-1",
	},
	{
		name: "earlier bind",
		expect: func(w *flowTestWorld) {
			w.expectParked(&flowengine.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)
		},
	},
	{
		name: "stale bind",
		expect: func(w *flowTestWorld) {
			w.expectStaleBind(&flowengine.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)
		},
		wantCheckID: "ch-1",
	},
}

// Every path mints the handoff on this render, so a lost earlier response
// still signs the user in.
func TestFlowStateMachine_Render_SSOHandoff(t *testing.T) {
	t.Parallel()
	for _, tt := range ssoHandoffPaths {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			tt.expect(w)
			w.authAttemptService.EXPECT().
				Handoff(gomock.Any(), flowengine.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
				Return(flowengine.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			require.Equal(t, "done", result.Step.Name)
			require.NotNil(t, result.Step.Complete)
			assert.Equal(t, "handoff-1", result.HandoffToken)
			assert.Equal(t, "user-1", result.State.CollectedData.UserID)
			assert.Equal(t, tt.wantCheckID, result.State.SSOResolvedCheckID)
		})
	}
}

// The bind deletes the exact row first, so a row another request replaced
// binds nothing on the attempt.
func TestFlowStateMachine_Render_SSOCollisionStaleRowBindsNothing(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", domain.ErrSSOStateInvalid())
	w.expectParked(nil, nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
}

// A concurrent request created the user from the same identity and bound the
// attempt, so this collision bind finds the row gone: it retries that
// request's handoff instead of resealing a stale cookie.
func TestFlowStateMachine_Render_SSOCollisionStaleRowAfterCreationRetriesHandoff(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", domain.ErrSSOStateInvalid())
	w.expectParked(&flowengine.FlowSSOParkedIdentity{BoundUserID: "user-9"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), flowengine.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
		Return(flowengine.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil).
		Times(1)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "done", result.Step.Name)
	assert.Equal(t, "handoff-1", result.HandoffToken)
	assert.Equal(t, "user-9", result.State.CollectedData.UserID)
}

// still a valid claim: resolution reads x-unique directly and goes on.
func TestFlowStateMachine_Render_SSOUnionTypedClaimDoesNotFailResolution(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com", "age": 42}, nil), nil)
	w.expectOwner("email", "alice@example.com", "")

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// A lookup miss is not a sign-in attempt: no identifier proof is submitted,
// so the attempt records no failed check.
func TestFlowStateMachine_Render_SSOCollisionProbeMissesRecordNoProof(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	verified["email"] = false
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.expectOwner("badge", "b-7", "")
	w.expectOwner("email", "alice@example.com", "")
	w.expectOwner("username", "alice", "")
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// A concurrent render won the handoff: the attempt is handed off, so this one
// restarts, as every later render of this cookie would.
func TestFlowStateMachine_Render_SSOHandoffLostRace(t *testing.T) {
	t.Parallel()
	for _, tt := range ssoHandoffPaths {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			tt.expect(w)
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).
				Return(flowengine.FlowHandoffOutput{}, domain.ErrAuthAttemptAlreadyHandedOff())

			_, err := w.sm.Render(t.Context(), def, state)
			require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
			assert.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
		})
	}
}

// A completed flow has handed its attempt off (and the session exchange may
// have deleted it), so a render on the terminal step reads nothing.
func TestFlowStateMachine_Render_TerminalStepSkipsResolution(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.CurrentStep = "done"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "done", result.Step.Name)
	// Marked complete, so GET /flows/{flow_id} can answer 410 for a finished flow.
	assert.NotNil(t, result.Step.Complete)
}

// A top-level property whose name has a dot would be stored as a nested
// object, so its claim is collected instead of created.
func TestFlowStateMachine_Render_SSODottedPropertyFallsBackToCollection(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorldWithSchema(t, `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"x-identifier": "email",
		"required": ["email"],
		"properties": {
			"email":     { "type": "string", "format": "email", "x-unique": "project" },
			"username":  { "type": "string" },
			"home.city": { "type": "string" }
		}
	}`)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(
		map[string]any{"email": "alice@example.com", "home.city": "Oxford"},
		map[string]bool{"email": true},
	), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// The attempt already carries another user: binding the owner would replace
// it, so the flow starts over and nothing is written.
func TestFlowStateMachine_Render_SSOCollisionOnAttemptBoundToOtherUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-a"
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "u-b")
	w.ssoIdentities.EXPECT().BindCollision(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Equal(t, "u-a", state.CollectedData.UserID)
}

// The attempt already carries the owner, so there is nothing to probe: the
// row is settled and the collision outcome raised.
func TestFlowStateMachine_Render_SSOCollisionOnAttemptBoundToSameUserBindsWithoutProbe(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-b"
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "u-b")
	w.expectBindCollision("u-b", nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-b", result.State.CollectedData.UserID)
}

// An identity that neither links to nor collides with the user the flow
// already carries cannot register a new user on that attempt.
func TestFlowStateMachine_Render_SSOUnlinkedIdentityOnBoundAttemptRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-a"
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Equal(t, "u-a", state.CollectedData.UserID)
}

// Composed requiredness (allOf, if/then, dependentRequired, ...) is not
// evaluated, so a schema that uses it cannot create a user unattended: an
// unverified unique claim could otherwise become required unseen.
func TestFlowStateMachine_Render_SSOComposedRequiredSchemaFallsBackToCollection(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorldWithSchema(t, `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"x-identifier": "email",
		"properties": {
			"email":    { "type": "string", "format": "email", "x-unique": "project" },
			"username": { "type": "string" }
		},
		"allOf": [ { "required": ["email"] } ]
	}`)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, map[string]bool{"email": false}), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// The collision keeps the parked row. When the sealed cookie from the first
// render is lost, the client renders again with its earlier state (no user,
// no guard): the same owner is bound again and the outcome raised again.
func TestFlowStateMachine_Render_SSOCollisionRetryAfterLostCookieRaisesAgain(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	lost := *state
	parked := unlinkedParked(map[string]any{"email": "alice@example.com"}, nil)
	w.expectParked(parked, nil)
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "user-9").Times(2)
	w.expectBindCollision("user-9", nil).Times(2)

	first, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", first.Step.Name)

	retry, err := w.sm.Render(t.Context(), def, &lost)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", retry.Step.Name)
	assert.Equal(t, "user-9", retry.State.CollectedData.UserID)
}

// A connection can map a superset of properties for several schemas; each
// schema consumes only the properties it defines, so the rest is not stored.
// A dotted key the schema does not define is ignored the same way.
func TestFlowStateMachine_Render_SSOUnknownClaimIsNotPersisted(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	claims, verified := completeClaims()
	withUnknown := maps.Clone(claims)
	withUnknown["nickname"] = "ali"
	withUnknown["address.city"] = "Oxford"
	w.expectParked(unlinkedParked(withUnknown, verified), nil)
	w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(3)
	w.ssoIdentities.EXPECT().
		CreateLinked(gomock.Any(), gomock.Cond(func(in flowengine.FlowSSOCreateInput) bool {
			return assert.ObjectsAreEqual(claims, in.Attributes)
		})).
		Return("user-new", nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "done", result.Step.Name)
}

// Composition below the root counts too: a required object whose own
// subschema makes a unique leaf required is not evaluated either, and a $ref
// can point anywhere. Both fall back to collection.
func TestFlowStateMachine_Render_SSONestedComposedRequiredFallsBackToCollection(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		schema string
		// The nested unique leaf is probed like a top-level one.
		probesNested bool
	}{
		"nested allOf": {probesNested: true, schema: `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"type": "object",
			"x-auth-methods": { "password": { "enabled": true } },
			"x-identifier": "email",
			"required": ["email", "address"],
			"properties": {
				"email":    { "type": "string", "format": "email", "x-unique": "project" },
				"username": { "type": "string" },
				"address":  {
					"type": "object",
					"properties": { "email": { "type": "string", "x-unique": "project" } },
					"allOf": [ { "required": ["email"] } ]
				}
			}
		}`},
		"double not": {probesNested: true, schema: `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"type": "object",
			"x-auth-methods": { "password": { "enabled": true } },
			"x-identifier": "email",
			"required": ["email", "address"],
			"properties": {
				"email":    { "type": "string", "format": "email", "x-unique": "project" },
				"username": { "type": "string" },
				"address":  {
					"type": "object",
					"properties": { "email": { "type": "string", "x-unique": "project" } },
					"not": { "not": { "required": ["email"] } }
				}
			}
		}`},
		"ref": {schema: `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"type": "object",
			"x-auth-methods": { "password": { "enabled": true } },
			"x-identifier": "email",
			"required": ["email", "address"],
			"$defs": { "address": { "type": "object", "properties": { "email": { "type": "string" } } } },
			"properties": {
				"email":    { "type": "string", "format": "email", "x-unique": "project" },
				"username": { "type": "string" },
				"address":  { "$ref": "#/$defs/address" }
			}
		}`},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorldWithSchema(t, tc.schema)
			def = withSSOOutcomeSteps(def)
			w.expectParked(unlinkedParked(
				map[string]any{"email": "alice@example.com", "address": map[string]any{"email": "home@example.com"}},
				map[string]bool{"email": true},
			), nil)
			w.expectOwner("email", "alice@example.com", "")
			if tc.probesNested {
				w.expectOwner("address.email", "home@example.com", "")
			}
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "sso-register", result.Step.Name)
		})
	}
}

// An array can carry x-unique and is stored as a unique claim, so a
// required unique array must arrive verified like any other unique property.
// It is probed as one value, as the unique index stores it.
func TestFlowStateMachine_Render_SSOUnverifiedRequiredUniqueArrayFallsBackToCollection(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorldWithSchema(t, `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"x-identifier": "email",
		"required": ["email", "aliases"],
		"properties": {
			"email":    { "type": "string", "format": "email", "x-unique": "project" },
			"username": { "type": "string" },
			"aliases":  { "type": "array", "items": { "type": "string" }, "x-unique": "project" }
		}
	}`)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(
		map[string]any{"email": "alice@example.com", "aliases": []any{"ali"}},
		map[string]bool{"email": true, "aliases": false},
	), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().
		FindUniqueOwner(gomock.Any(), testProjectID, defaultSchemaURL, "aliases", []any{"ali"}).
		Return("", nil)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// A concurrent collision bound "u-b" while this flow's cookie recorded the
// row as collected: the state catches up and the collision outcome is raised.
// Back to an entry step starts a new ceremony; back to the collection step
// would find no row to create from, so it is not offered.
func TestFlowStateMachine_Render_SSOCollisionReconcilesLostCookieRace(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		world    func(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState)
		wantBack bool
	}{
		"entry step": {
			world: func(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState) {
				w, def, state := ssoRenderWorld(t)
				state.SSOResolvedCheckID = "ch-1"
				return w, withSSOOutcomeSteps(def), state
			},
			wantBack: true,
		},
		"collection step": {
			world: func(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState) {
				w, def, state := submittableCollectionStepWorld(t)
				// The marker is no collected row.
				w.expectCollected(nil, nil)
				return w, def, state
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := tc.world(t)
			w.ssoIdentities.EXPECT().
				LoadParked(gomock.Any(), flowengine.FlowSSOLoadInput{
					ProjectID: testProjectID, AttemptID: "att-1", UserSchemaURL: defaultSchemaURL, ResolvedCheckID: "ch-1",
				}).
				Return(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "sso-conflict", result.Step.Name)
			assert.Equal(t, "u-b", result.State.CollectedData.UserID)
			assert.True(t, result.Reseal)
			assert.Equal(t, tc.wantBack, len(result.State.BackStack) > 0)
		})
	}
}

// The catch-up runs on the step the cookie now holds, which may not route
// user_already_exists: the step shows the provider as unavailable instead of
// failing every render until the attempt expires.
func TestFlowStateMachine_Render_SSOCollisionReconcileUnroutableRendersError(t *testing.T) {
	t.Parallel()
	action := domain.Switch
	for name, transition := range map[string]*domain.FlowStepTransition{
		"missing":     nil,
		"with action": {Target: "other-flow", Action: &action},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			if transition != nil {
				def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = *transition
			}
			state.SSOResolvedCheckID = "ch-1"
			w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).
				Return(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, flowengine.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.False(t, result.Reseal)
		})
	}
}

func TestFlowStateMachine_Render_SSOCollisionReconcileWithRecordedUserRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.SSOResolvedCheckID = "ch-1"
	state.CollectedData.UserID = "u-b"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.False(t, result.Reseal)
}

// The flow identified u-b before SSO, and the response that routed the
// collision was lost: the cookie names the user but not the row, so the
// outcome is raised again.
func TestFlowStateMachine_Render_SSOCollisionReconcileWithUserIdentifiedBeforeSSORaisesAgain(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-b"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-b", result.State.CollectedData.UserID)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

func TestFlowStateMachine_Render_SSOCollisionReconcileWithOtherUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.SSOResolvedCheckID = "ch-1"
	state.CollectedData.UserID = "u-a"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// The attempt carries the user of a signed-in session the flow started on,
// which the flow state does not record. An identity that does not collide
// with that user cannot register a new one on this attempt.
func TestFlowStateMachine_Render_SSOUnlinkedIdentityOnSessionBoundAttemptRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	parked := unlinkedParked(map[string]any{"email": "alice@example.com"}, nil)
	parked.AttemptUserID = "u-s"
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// The probe finds the very user the session-bound attempt carries: that is a
// collision bound to that user, not a restart.
func TestFlowStateMachine_Render_SSOCollisionOnSessionBoundAttemptSameOwnerBinds(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	parked := unlinkedParked(map[string]any{"email": "alice@example.com"}, nil)
	parked.AttemptUserID = "u-s"
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "u-s")
	w.expectBindCollision("u-s", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-s", result.State.CollectedData.UserID)
}

// The marker names u-a but the attempt now carries u-b (a stale submission
// overwrote the user factor after the collision): the marker cannot be
// trusted, and the flow starts over without recording anyone.
func TestFlowStateMachine_Render_SSOCollisionMarkerWithDifferentAttemptUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).
		Return(&flowengine.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-a", AttemptUserID: "u-b"}, nil)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// withSSOCollectionStep turns sso-register of [withSSOOutcomeSteps] into the
// step that creates the user from the parked identity.
func withSSOCollectionStep(def *domain.FlowDefinition) *domain.FlowDefinition {
	def = withSSOOutcomeSteps(def)
	withSSO := domain.FlowOnSuccessCreateUserWithSso
	step := &def.Steps[len(def.Steps)-1]
	step.Fields = []domain.Field{"email", "username", "given_name", "family_name"}
	step.OnSuccess = &withSSO
	return def
}

// collectionStepWorld sits on the collection step after the engine resolved
// the parked row ch-1 into it.
func collectionStepWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState) {
	t.Helper()
	w, def, state := ssoRenderWorld(t)
	state.CurrentStep = "sso-register"
	state.SSOResolvedCheckID = "ch-1"
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), flowengine.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(nil, nil)
	return w, withSSOCollectionStep(def), state
}

// expectCollected makes LoadCollected hand back collected for the row ch-1.
func (w *flowTestWorld) expectCollected(collected *flowengine.FlowSSOParkedIdentity, err error) *flowenginemock.MockFlowSSOIdentityServiceLoadCollectedCall {
	return w.ssoIdentities.EXPECT().
		LoadCollected(gomock.Any(), flowengine.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(collected, err)
}

// renderedValues maps each prefilled field to its value.
func renderedValues(fields []domain.FlowField) map[string]string {
	values := map[string]string{}
	for _, f := range fields {
		if f.Value != nil {
			values[f.Name] = *f.Value
		}
	}
	return values
}

// An identity the provider left incomplete is collected on a step that
// renders with the provider's claims filled in.
func TestFlowStateMachine_Render_SSOUserNotFoundPrefillsCollectionStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOCollectionStep(def)
	parked := unlinkedParked(map[string]any{"email": "alice@example.com", "given_name": "Alice"}, map[string]bool{"email": true})
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "")
	w.expectCollected(parked, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-register", result.Step.Name)
	assert.Equal(t, map[string]string{"email": "alice@example.com", "given_name": "Alice"}, renderedValues(result.Step.Fields))
	assert.Nil(t, result.Step.Notice, "a sign-up that stays one has nothing to explain")
}

// A provider's sign-in with no account turns a sign-in into a sign-up, and
// the step it lands on says why.
func TestFlowStateMachine_Render_SSOUserNotFoundOnSignInCarriesNotice(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOCollectionStep(def)
	state.Purpose = domain.FlowDefinitionPurposeLogin
	state.CurrentPurpose = domain.FlowDefinitionPurposeLogin
	parked := unlinkedParked(map[string]any{"email": "alice@example.com"}, map[string]bool{"email": true})
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "")
	w.expectCollected(parked, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-register", result.Step.Name)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.Step.Purpose)
	require.NotNil(t, result.Step.Notice)
	assert.Equal(t, flowengine.FlowStepNoticeSSOUserNotFound, *result.Step.Notice)
}

// The provider's claims fill the fields first, and what earlier steps
// collected fills the rest. A claim that is not a string prefills nothing.
func TestFlowStateMachine_Render_SSOCollectionStepPrefillsClaimsBeforeCollected(t *testing.T) {
	t.Parallel()
	w, def, state := collectionStepWorld(t)
	state.CollectedData.UserData = map[string]any{"email": "typed@example.com", "username": "typed", "given_name": "Typed"}
	w.expectCollected(unlinkedParked(map[string]any{"email": "alice@example.com", "given_name": 42}, nil), nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		"email":      "alice@example.com",
		"username":   "typed",
		"given_name": "Typed",
	}, renderedValues(result.Step.Fields))
}

// With no parked row the step renders empty and with no error. Values earlier
// steps collected are not filled in either: the submit cannot succeed.
func TestFlowStateMachine_Render_SSOCollectionStepWithoutParkedRowRendersEmpty(t *testing.T) {
	t.Parallel()
	w, def, state := collectionStepWorld(t)
	state.CollectedData.UserData = map[string]any{"email": "typed@example.com", "username": "typed"}
	w.expectCollected(nil, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, renderedValues(result.Step.Fields))
}

// A field showing a verified unique claim renders read-only, since the submit
// refuses a changed value. Every other field stays editable.
func TestFlowStateMachine_Render_SSOCollectionStepReadOnlyFields(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		fields []domain.Field
		parked *flowengine.FlowSSOParkedIdentity
		want   []string
	}{
		{
			name:   "verified unique claim",
			parked: unlinkedParked(map[string]any{"email": "alice@example.com"}, map[string]bool{"email": true}),
			want:   []string{"email"},
		},
		{
			name:   "verified unique leaf of a claim object",
			fields: []domain.Field{"email", "account.handle"},
			parked: unlinkedParked(map[string]any{"account": map[string]any{"handle": "ali"}}, map[string]bool{"account": true}),
			want:   []string{"account.handle"},
		},
		{
			name:   "unverified unique claim",
			parked: unlinkedParked(map[string]any{"email": "alice@example.com"}, map[string]bool{"email": false}),
		},
		{
			name:   "verified claim that is not unique",
			parked: unlinkedParked(map[string]any{"given_name": "Alice"}, map[string]bool{"given_name": true}),
		},
		{
			name:   "verified unique claim that is not a string",
			fields: []domain.Field{"email", "employee_id"},
			parked: unlinkedParked(map[string]any{"employee_id": 42}, map[string]bool{"employee_id": true}),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			w, def, state := collectionStepWorld(t)
			if tc.fields != nil {
				def.Steps[len(def.Steps)-1].Fields = tc.fields
			}
			w.expectCollected(tc.parked, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			var readOnly []string
			for _, f := range result.Step.Fields {
				if f.ReadOnly {
					readOnly = append(readOnly, f.Name)
				}
			}
			assert.Equal(t, tc.want, readOnly)
		})
	}
}

func TestFlowStateMachine_Render_SSOCollectionStepLoadErrorPropagates(t *testing.T) {
	t.Parallel()
	w, def, state := collectionStepWorld(t)
	w.expectCollected(nil, domain.ErrFlowRestartRequired())

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// submittableCollectionStepWorld sits on the collection step after the engine
// resolved the row ch-1 into it, from credentials. The step submits to done
// and routes a collision to sso-conflict.
func submittableCollectionStepWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState) {
	t.Helper()
	w, def, state := ssoRenderWorld(t)
	def = withSSOCollectionStep(def)
	step := &def.Steps[len(def.Steps)-1]
	step.Actions = []domain.FlowStepAction{{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true}}
	step.Transitions = map[string]domain.FlowStepTransition{
		flowengine.FlowActionSubmit:                 {Target: "done"},
		domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "sso-conflict"},
	}
	state.CurrentStep = "sso-register"
	state.SSOResolvedCheckID = "ch-1"
	state.History = []string{"credentials"}
	state.BackStack = []flowengine.FlowBackEntry{{StepName: "credentials", Purpose: domain.FlowDefinitionPurposeRegister}}
	return w, def, state
}

// boundCollectionStepWorld sits on the collection step, whose only submit
// action routes to done, after an earlier request created the user on it but
// did not deliver the handoff: the row is gone and the attempt is bound.
func boundCollectionStepWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *flowengine.FlowState) {
	t.Helper()
	w, def, state := submittableCollectionStepWorld(t)
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), flowengine.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(&flowengine.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)
	// The step's inputs resolve before the retry, and the prefill finds the
	// row gone.
	w.expectCollected(nil, nil)
	return w, def, state
}

// The collection step routes no sso_authenticated, so the retry follows the
// transition the create follows, and the step that created the user offers
// no back. sso_authenticated still wins where the step routes it, and keeps
// the back stack, as on any other step.
func TestFlowStateMachine_Render_SSOCollectionStepRetriesHandoff(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		edit          func(step *domain.FlowDefinitionStep)
		wantStep      string
		wantBackStack bool
	}{
		"submit action": {edit: func(*domain.FlowDefinitionStep) {}, wantStep: "done"},
		"renamed submit action": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Actions[0].Name = "create"
				step.Transitions = map[string]domain.FlowStepTransition{"create": {Target: "done"}}
			},
			wantStep: "done",
		},
		"navigate action beside it": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Actions = append(step.Actions, domain.FlowStepAction{Name: "sign_in", Kind: domain.FlowActionKindNavigate})
				step.Transitions["sign_in"] = domain.FlowStepTransition{Target: "credentials"}
			},
			wantStep: "done",
		},
		// A later step, not the end of the flow, shows the back stack.
		"submit to a later step": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Transitions[flowengine.FlowActionSubmit] = domain.FlowStepTransition{Target: "sso-conflict"}
			},
			wantStep: "sso-conflict",
		},
		"sso_authenticated routed": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = domain.FlowStepTransition{Target: "sso-conflict"}
			},
			wantStep:      "sso-conflict",
			wantBackStack: true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := boundCollectionStepWorld(t)
			tc.edit(&def.Steps[len(def.Steps)-1])
			if tc.wantStep == "done" {
				w.authAttemptService.EXPECT().
					Handoff(gomock.Any(), flowengine.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
					Return(flowengine.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)
			}

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			require.Equal(t, tc.wantStep, result.Step.Name)
			assert.Equal(t, "user-1", result.State.CollectedData.UserID)
			assert.Equal(t, tc.wantBackStack, len(result.State.BackStack) > 0)
		})
	}
}

// A transition that would drop the bound user, or a step whose submit
// actions leave the retry no single route, keeps the step and shows the
// provider as unavailable, as on any step that cannot route the retry.
func TestFlowStateMachine_Render_SSOCollectionStepUnroutableRetry(t *testing.T) {
	t.Parallel()
	register := domain.FlowDefinitionPurposeRegister
	action := domain.Switch
	for name, edit := range map[string]func(step *domain.FlowDefinitionStep){
		"with purpose": func(step *domain.FlowDefinitionStep) {
			step.Transitions[flowengine.FlowActionSubmit] = domain.FlowStepTransition{Target: "done", Purpose: &register}
		},
		"with action": func(step *domain.FlowDefinitionStep) {
			step.Transitions[flowengine.FlowActionSubmit] = domain.FlowStepTransition{Target: "other-flow", Action: &action}
		},
		"two submit actions": func(step *domain.FlowDefinitionStep) {
			step.Actions = append(step.Actions, domain.FlowStepAction{Name: "get_help", Kind: domain.FlowActionKindSubmit})
			step.Transitions["get_help"] = domain.FlowStepTransition{Target: "done"}
		},
		"no submit action": func(step *domain.FlowDefinitionStep) {
			step.Actions = nil
			step.Transitions = nil
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := boundCollectionStepWorld(t)
			edit(&def.Steps[len(def.Steps)-1])
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "sso-register", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, flowengine.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.False(t, result.Reseal)
		})
	}
}

// collectionSubmit is a complete submit of the collection step's fields.
func collectionSubmit(edit func(fields map[string]any)) flowengine.FlowSubmitInput {
	fields := map[string]any{
		"email":       "alice@example.com",
		"username":    "alice",
		"given_name":  "Alice",
		"family_name": "Liddell",
	}
	edit(fields)
	return flowengine.FlowSubmitInput{Action: flowengine.FlowActionSubmit, Fields: fields}
}

// expectCreateLinked answers the creation of the collected identity.
func (w *flowTestWorld) expectCreateLinked(attributes map[string]any, password, userID string, err error) *flowenginemock.MockFlowSSOIdentityServiceCreateLinkedCall {
	return w.ssoIdentities.EXPECT().
		CreateLinked(gomock.Any(), flowengine.FlowSSOCreateInput{
			ProjectID:     testProjectID,
			AttemptID:     "att-1",
			CheckID:       "ch-1",
			UserSchemaURL: defaultSchemaURL,
			ConnectionID:  "idp-1",
			Subject:       "sub-1",
			Attributes:    attributes,
			Password:      password,
		}).
		Return(userID, err)
}

// The collection submit creates the user from the submitted values and the
// claims the step does not show, and the step that created the user offers
// no back. The identifier is not submitted as a sign-in.
func TestFlowStateMachine_Process_SSOCollectionCreatesUser(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		fields         []domain.Field
		claims         map[string]any
		verified       map[string]bool
		collected      map[string]any
		edit           func(fields map[string]any)
		wantAttributes map[string]any
		wantPassword   string
		wantProbes     map[string]any
	}{
		// A hidden claim replaces what an earlier step collected, and is stored
		// whatever its type when it satisfies its property.
		"submitted values and hidden claims": {
			claims:    map[string]any{"email": "alice@example.com", "badge": "b-7", "age": 42},
			verified:  map[string]bool{"email": true, "badge": true},
			collected: map[string]any{"badge": "typed"},
			edit:      func(map[string]any) {},
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7", "age": 42,
			},
		},
		"hidden claim failing its property": {
			fields:    []domain.Field{"email", "username", "family_name"},
			claims:    map[string]any{"email": "alice@example.com", "given_name": "", "badge": "b-7", "locale": "en-GB"},
			collected: map[string]any{"given_name": "Typed"},
			edit:      func(fields map[string]any) { delete(fields, "given_name") },
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Typed", "family_name": "Liddell", "badge": "b-7",
			},
		},
		"hidden claim failing its format": {
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7", "homepage": "no scheme"},
			edit:   func(map[string]any) {},
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
			},
		},
		// The typed leaf wins, and the hidden ones are stored beside it.
		"hidden leaves beside a shown one": {
			fields: []domain.Field{"email", "username", "given_name", "family_name", "address.street_address"},
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7", "address": map[string]any{
				"street_address": "1 Main St", "locality": "Berlin", "country": "DE",
			}},
			edit: func(fields map[string]any) { fields["address.street_address"] = "2 Side St" },
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
				"address": map[string]any{"street_address": "2 Side St", "locality": "Berlin", "country": "DE"},
			},
		},
		"hidden object with a key the schema does not define": {
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7", "address": map[string]any{
				"locality": "Berlin", "country": "DE", "planet": "Earth",
			}},
			edit: func(map[string]any) {},
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
				"address": map[string]any{"locality": "Berlin", "country": "DE"},
			},
		},
		// country fails its enum, and without it the object fails its own
		// property, so none of it is stored.
		"hidden object failing its property": {
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7", "address": map[string]any{
				"locality": "Berlin", "country": "Germany",
			}},
			edit: func(map[string]any) {},
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
			},
		},
		// The key the schema does not define is left out, which is no edit.
		"verified object unchanged": {
			fields: []domain.Field{"email", "username", "given_name", "family_name", "account.handle"},
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7", "account": map[string]any{
				"handle": "ali", "id": "g-123",
			}},
			verified: map[string]bool{"email": true, "account": true},
			edit:     func(fields map[string]any) { fields["account.handle"] = "ali" },
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
				"account": map[string]any{"handle": "ali"},
			},
			wantProbes: map[string]any{"account.handle": "ali"},
		},
		"unverified unique value edited": {
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7"},
			edit:   func(fields map[string]any) { fields["email"] = "alice@work.example.com" },
			wantAttributes: map[string]any{
				"email": "alice@work.example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
			},
		},
		"password collected on the step": {
			fields: []domain.Field{"email", "username", "given_name", "family_name", "x-auth-methods#password"},
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7"},
			edit:   func(fields map[string]any) { fields["x-auth-methods#password"] = "correct-horse-battery-staple" },
			wantAttributes: map[string]any{
				"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
			},
			wantPassword: "correct-horse-battery-staple",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := submittableCollectionStepWorld(t)
			step := &def.Steps[len(def.Steps)-1]
			if tc.fields != nil {
				step.Fields = tc.fields
			}
			// A later step, not the end of the flow, shows the back stack.
			step.Transitions[flowengine.FlowActionSubmit] = domain.FlowStepTransition{Target: "sso-conflict"}
			state.CollectedData.UserData = tc.collected
			w.expectCollected(unlinkedParked(tc.claims, tc.verified), nil).Times(2)
			in := collectionSubmit(tc.edit)
			w.expectOwner("badge", "b-7", "")
			w.expectOwner("email", tc.wantAttributes["email"].(string), "")
			w.expectOwner("username", "alice", "")
			for attribute, value := range tc.wantProbes {
				w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), testProjectID, defaultSchemaURL, attribute, value).Return("", nil)
			}
			w.expectCreateLinked(tc.wantAttributes, tc.wantPassword, "user-1", nil)

			result, err := w.sm.Process(t.Context(), def, state, in)
			require.NoError(t, err)
			require.Equal(t, "sso-conflict", result.Step.Name)
			assert.Equal(t, "user-1", result.State.CollectedData.UserID)
			assert.Empty(t, result.State.BackStack)
		})
	}
}

// A unique value another user holds binds that user, as on the render: on the
// probe, or on a creation that lost the value to another flow since. The bind
// replaced the row the step creates from, so it offers no back.
func TestFlowStateMachine_Process_SSOCollectionBindsCollision(t *testing.T) {
	t.Parallel()
	takeUsername := func(fields map[string]any) { fields["username"] = "taken" }
	for name, tc := range map[string]struct {
		fields []domain.Field
		claims map[string]any
		edit   func(fields map[string]any)
		expect func(w *flowTestWorld)
	}{
		// The bind creates nothing, so it does not need the properties a
		// creation requires.
		"probe": {claims: map[string]any{"email": "alice@example.com"}, edit: takeUsername, expect: func(w *flowTestWorld) {
			gomock.InOrder(
				w.expectOwner("email", "alice@example.com", ""),
				w.expectOwner("username", "taken", "user-9"),
				w.expectBindCollision("user-9", nil),
			)
		}},
		"creation": {claims: map[string]any{"email": "alice@example.com", "badge": "b-7"}, edit: takeUsername, expect: func(w *flowTestWorld) {
			gomock.InOrder(
				w.expectOwner("badge", "b-7", ""),
				w.expectOwner("email", "alice@example.com", ""),
				w.expectOwner("username", "taken", ""),
				w.expectCreateLinked(map[string]any{
					"email": "alice@example.com", "username": "taken", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
				}, "", "", domain.ErrUserAlreadyExists()),
				w.expectOwner("badge", "b-7", ""),
				w.expectOwner("email", "alice@example.com", ""),
				w.expectOwner("username", "taken", "user-9"),
				w.expectBindCollision("user-9", nil),
			)
		}},
		// The new user has no team, so it collides with a team-unique value of
		// a user with no team, which the lookup finds.
		"team-unique value of a user without a team": {claims: map[string]any{"email": "alice@example.com", "badge": "b-7"}, edit: func(map[string]any) {}, expect: func(w *flowTestWorld) {
			gomock.InOrder(
				w.expectOwner("badge", "b-7", "user-9"),
				w.expectBindCollision("user-9", nil),
			)
		}},
		"nested value": {
			fields: []domain.Field{"email", "username", "given_name", "family_name", "account.handle"},
			claims: map[string]any{"email": "alice@example.com"},
			edit:   func(fields map[string]any) { fields["account.handle"] = "taken" },
			expect: func(w *flowTestWorld) {
				gomock.InOrder(
					w.expectOwner("account.handle", "taken", "user-9"),
					w.expectBindCollision("user-9", nil),
				)
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := submittableCollectionStepWorld(t)
			if tc.fields != nil {
				def.Steps[len(def.Steps)-1].Fields = tc.fields
			}
			w.expectCollected(unlinkedParked(tc.claims, nil), nil).Times(2)
			tc.expect(w)

			result, err := w.sm.Process(t.Context(), def, state, collectionSubmit(tc.edit))
			require.NoError(t, err)
			require.Equal(t, "sso-conflict", result.Step.Name)
			assert.Equal(t, "user-9", result.State.CollectedData.UserID)
			assert.Empty(t, result.State.BackStack)
		})
	}
}

// A submit that cannot create the user keeps the step and says why. Nothing
// is created where the error comes before the creation.
func TestFlowStateMachine_Process_SSOCollectionStepErrors(t *testing.T) {
	t.Parallel()
	register := domain.FlowDefinitionPurposeRegister
	complete := map[string]any{
		"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
	}
	probeMisses := func(w *flowTestWorld) {
		w.expectOwner("badge", "b-7", "")
		w.expectOwner("email", "alice@example.com", "")
		w.expectOwner("username", "alice", "")
	}
	// schemaInvalid is the error the user service returns for doc failing
	// schema.
	schemaInvalid := func(schema string, doc map[string]any) error {
		var s jsonschema.Schema
		require.NoError(t, json.Unmarshal([]byte(schema), &s))
		return domain.ErrUserInvalid().WithParent(s.Validate(doc))
	}
	for name, tc := range map[string]struct {
		fields   []domain.Field
		claims   map[string]any
		verified map[string]bool
		edit     func(fields map[string]any)
		route    *domain.FlowStepTransition
		unrouted bool
		expect   func(w *flowTestWorld)
		wantErr  string
	}{
		"verified unique value edited": {
			claims:  map[string]any{"email": "alice@example.com", "badge": "b-7"},
			edit:    func(fields map[string]any) { fields["email"] = "mallory@example.com" },
			expect:  func(*flowTestWorld) {},
			wantErr: flowengine.FlowStepErrorSSOVerifiedUniqueValueChanged,
		},
		// The step cannot prefill a number, and typed digits are a string, not
		// the claimed number.
		"verified number typed as digits": {
			fields:   []domain.Field{"email", "username", "given_name", "family_name", "employee_id"},
			claims:   map[string]any{"email": "alice@example.com", "badge": "b-7", "employee_id": float64(42)},
			verified: map[string]bool{"email": true, "employee_id": true},
			edit:     func(fields map[string]any) { fields["employee_id"] = "42" },
			expect:   func(*flowTestWorld) {},
			wantErr:  flowengine.FlowStepErrorSSOVerifiedUniqueValueChanged,
		},
		"unique leaf of a verified object edited": {
			fields: []domain.Field{"email", "username", "given_name", "family_name", "account.handle"},
			claims: map[string]any{"email": "alice@example.com", "badge": "b-7", "account": map[string]any{
				"handle": "ali", "id": "g-123",
			}},
			verified: map[string]bool{"email": true, "account": true},
			edit:     func(fields map[string]any) { fields["account.handle"] = "bob" },
			expect:   func(*flowTestWorld) {},
			wantErr:  flowengine.FlowStepErrorSSOVerifiedUniqueValueChanged,
		},
		// The schema changed since the callback, which refuses such a claim.
		"verified unique claim the schema rejects": {
			claims:   map[string]any{"email": "alice@example.com", "badge": "b-7", "username": strings.Repeat("a", 65)},
			verified: map[string]bool{"email": true, "username": true},
			expect:   func(*flowTestWorld) {},
			wantErr:  flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		// badge is required, the step has no field for it, and the provider
		// sent none.
		"required property neither shown nor claimed": {
			claims: map[string]any{"email": "alice@example.com"},
			expect: func(w *flowTestWorld) {
				w.expectOwner("email", "alice@example.com", "")
				w.expectOwner("username", "alice", "")
			},
			wantErr: flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		"values that fail only together": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", domain.ErrUserInvalid())
			},
			wantErr: flowengine.FlowStepErrorSSOUserInvalid,
		},
		// No step shows a property of an array item, so this one was not
		// left out of the step.
		"property an array item requires": {
			expect: func(w *flowTestWorld) {
				_, err := domain.NewCreateUser(domain.CreateUserParams{
					ProjectID:  "proj_1",
					SchemaURL:  "https://example.test/schema.json",
					Schema:     []byte(`{"properties": {"phones": {"items": {"required": ["fax"]}}}}`),
					Attributes: map[string]any{"phones": []any{map[string]any{}}},
				})
				require.Error(t, err)
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", err)
			},
			wantErr: flowengine.FlowStepErrorSSOUserInvalid,
		},
		"property allOf requires that the step does not show": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", schemaInvalid(`{"allOf": [{"required": ["phone"]}]}`, complete))
			},
			wantErr: flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		"property a reference requires that the step does not show": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", schemaInvalid(`{"$defs": {"user": {"required": ["phone"]}}, "$ref": "#/$defs/user"}`, complete))
			},
			wantErr: flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		"nested property allOf requires that the step does not show": {
			fields: []domain.Field{"email", "username", "given_name", "family_name", "account.handle"},
			edit:   func(fields map[string]any) { fields["account.handle"] = "ali" },
			expect: func(w *flowTestWorld) {
				attributes := maps.Clone(complete)
				attributes["account"] = map[string]any{"handle": "ali"}
				probeMisses(w)
				w.expectOwner("account.handle", "ali", "")
				w.expectCreateLinked(attributes, "", "", schemaInvalid(
					`{"properties": {"account": {"allOf": [{"required": ["id"]}]}}}`, attributes))
			},
			wantErr: flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		// The schema library reports a then requirement without its condition,
		// so clearing given_name does not count as a fix.
		"property a then requires that the step does not show": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", schemaInvalid(`{"if": {"required": ["given_name"]}, "then": {"required": ["phone"]}}`, complete))
			},
			wantErr: flowengine.FlowStepErrorSSOUserCannotBeCreated,
		},
		// The user can fill the field in.
		"property allOf requires that the step shows": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", schemaInvalid(`{"allOf": [{"required": ["given_name", "phone"]}]}`, map[string]any{"phone": "1"}))
			},
			wantErr: flowengine.FlowStepErrorSSOUserInvalid,
		},
		// The schema library does not say which property anyOf misses.
		"property one anyOf branch requires": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", schemaInvalid(`{"anyOf": [{"required": ["phone"]}, {"required": ["fax"]}]}`, complete))
			},
			wantErr: flowengine.FlowStepErrorSSOUserInvalid,
		},
		"password the policy rejects": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", domain.ErrUserPasswordPolicyViolation(map[string]any{"max_length": int64(64)}))
			},
			wantErr: "error.x-auth-methods#password_max_length",
		},
		"taken value without an owner": {
			expect: func(w *flowTestWorld) {
				probeMisses(w)
				w.expectCreateLinked(complete, "", "", domain.ErrUserAlreadyExists())
				probeMisses(w)
			},
			wantErr: flowengine.FlowStepErrorUserAlreadyExists,
		},
		// Unlike the callback, the submit does not restart: the user typed the
		// value and can change it.
		"value held by a user of another schema": {
			expect: func(w *flowTestWorld) {
				w.expectOwner("badge", "b-7", "")
				w.expectOwner("email", "alice@example.com", "")
				w.expectOwner("username", "alice", "").Return("", domain.ErrSSOOwnerOtherSchema)
			},
			wantErr: flowengine.FlowStepErrorUserAlreadyExists,
		},
		"collision the step cannot route": {
			unrouted: true,
			expect: func(w *flowTestWorld) {
				w.expectOwner("badge", "b-7", "")
				w.expectOwner("email", "alice@example.com", "user-9")
			},
			wantErr: flowengine.FlowStepErrorSSOUnavailable,
		},
		"submit that drops the user": {
			route:   &domain.FlowStepTransition{Target: "done", Purpose: &register},
			expect:  func(*flowTestWorld) {},
			wantErr: flowengine.FlowStepErrorSSOUnavailable,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := submittableCollectionStepWorld(t)
			step := &def.Steps[len(def.Steps)-1]
			if tc.fields != nil {
				step.Fields = tc.fields
			}
			if tc.route != nil {
				step.Transitions[flowengine.FlowActionSubmit] = *tc.route
			}
			if tc.unrouted {
				delete(step.Transitions, domain.FlowImplicitOutcomeUserAlreadyExists)
			}
			claims := tc.claims
			if claims == nil {
				claims = map[string]any{"email": "alice@example.com", "badge": "b-7"}
			}
			verified := tc.verified
			if verified == nil {
				verified = map[string]bool{"email": true}
			}
			w.expectCollected(unlinkedParked(claims, verified), nil).MinTimes(1).MaxTimes(2)
			tc.expect(w)
			edit := tc.edit
			if edit == nil {
				edit = func(map[string]any) {}
			}

			result, err := w.sm.Process(t.Context(), def, state, collectionSubmit(edit))
			require.NoError(t, err)
			assert.Equal(t, "sso-register", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, tc.wantErr, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
		})
	}
}

// A submit whose row is gone or was claimed by another request: a user bound
// on the attempt signs in through the retry, a handed-off attempt restarts,
// and anything else shows the step again.
func TestFlowStateMachine_Process_SSOCollectionStaleRow(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		collected *flowengine.FlowSSOParkedIdentity
		claimed   bool
		reread    *flowengine.FlowSSOParkedIdentity
		rereadErr error
		wantStep  string
		wantUser  string
		wantErr   error
	}{
		"bound": {
			reread:   &flowengine.FlowSSOParkedIdentity{BoundUserID: "user-1"},
			wantStep: "sso-conflict",
			wantUser: "user-1",
		},
		"handed off": {rereadErr: domain.ErrFlowRestartRequired(), wantErr: domain.ErrFlowRestartRequired()},
		"replaced":   {wantStep: "sso-register"},
		"claimed by the creation": {
			collected: unlinkedParked(map[string]any{"email": "alice@example.com", "badge": "b-7"}, nil),
			claimed:   true,
			wantStep:  "sso-register",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := submittableCollectionStepWorld(t)
			step := &def.Steps[len(def.Steps)-1]
			step.Transitions[flowengine.FlowActionSubmit] = domain.FlowStepTransition{Target: "sso-conflict"}
			w.expectCollected(tc.collected, nil).Times(2)
			if tc.claimed {
				w.expectOwner("badge", "b-7", "")
				w.expectOwner("email", "alice@example.com", "")
				w.expectOwner("username", "alice", "")
				w.expectCreateLinked(map[string]any{
					"email": "alice@example.com", "username": "alice", "given_name": "Alice", "family_name": "Liddell", "badge": "b-7",
				}, "", "", domain.ErrSSOStateInvalid())
			}
			w.ssoIdentities.EXPECT().
				LoadParked(gomock.Any(), flowengine.FlowSSOLoadInput{
					ProjectID:       testProjectID,
					AttemptID:       "att-1",
					UserSchemaURL:   defaultSchemaURL,
					ResolvedCheckID: "ch-1",
				}).
				Return(tc.reread, tc.rereadErr)

			result, err := w.sm.Process(t.Context(), def, state, collectionSubmit(func(map[string]any) {}))
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.wantStep, result.Step.Name)
			assert.Nil(t, result.Step.Error)
			assert.Equal(t, tc.wantUser, result.State.CollectedData.UserID)
		})
	}
}

// A submit the step cannot take writes nothing: an action the step does not
// declare, a flow that resolved no identity into the step, or a state that
// already carries a user.
func TestFlowStateMachine_Process_SSOCollectionRefusedSubmit(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		edit      func(state *flowengine.FlowState, in *flowengine.FlowSubmitInput)
		wantErr   error
		wantReads int
	}{
		"undeclared action": {
			edit: func(_ *flowengine.FlowState, in *flowengine.FlowSubmitInput) {
				in.Action = domain.FlowImplicitOutcomeUserAlreadyExists
			},
			wantErr:   domain.ErrFlowInvalidAction(),
			wantReads: 0,
		},
		"no resolved identity": {
			edit:      func(state *flowengine.FlowState, _ *flowengine.FlowSubmitInput) { state.SSOResolvedCheckID = "" },
			wantErr:   domain.ErrFlowIntegrity(),
			wantReads: 1,
		},
		"user already recorded": {
			edit: func(state *flowengine.FlowState, _ *flowengine.FlowSubmitInput) {
				state.CollectedData.UserID = "user-1"
			},
			wantErr:   domain.ErrFlowRestartRequired(),
			wantReads: 1,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := submittableCollectionStepWorld(t)
			in := collectionSubmit(func(map[string]any) {})
			tc.edit(state, &in)
			// Only the prefill reads the row. An undeclared action is refused
			// before the prefill, so it reads nothing.
			w.ssoIdentities.EXPECT().LoadCollected(gomock.Any(), gomock.Any()).Return(nil, nil).Times(tc.wantReads)

			_, err := w.sm.Process(t.Context(), def, state, in)
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}
