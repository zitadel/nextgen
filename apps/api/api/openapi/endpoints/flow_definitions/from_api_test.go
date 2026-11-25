package flow_definitions

import (
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// The generated request decoder refuses these values before a handler runs;
// the conversion refuses them too rather than store a zero value.
func TestStepsFromAPI_RefusesUnknownValues(t *testing.T) {
	t.Parallel()

	tests := map[string]api.FlowDefinitionStep{
		"action kind": {
			Name:    "identifier",
			Actions: []api.StepAction{{Name: "submit", Kind: "teleport"}},
		},
		"gate kind": {
			Name: "identifier",
			Gates: api.NewOptFlowDefinitionStepGates(api.FlowDefinitionStepGates{
				"bot_check": {Kind: "puzzle", Provider: "example"},
			}),
		},
		"gate config that is not JSON": {
			Name: "identifier",
			Gates: api.NewOptFlowDefinitionStepGates(api.FlowDefinitionStepGates{
				"bot_check": {
					Kind:     api.GateKindCaptcha,
					Provider: "example",
					Config:   api.NewOptGateConfig(api.GateConfig{"site_key": jx.Raw("{")}),
				},
			}),
		},
		"transition action": {
			Name: "identifier",
			Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
				"next": {Action: api.NewOptNilFlowDefinitionStepTransitionsItemAction("jump")},
			}),
		},
		"transition purpose": {
			Name: "identifier",
			Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
				"next": {Purpose: api.NewOptNilFlowDefinitionStepTransitionsItemPurpose("vacation")},
			}),
		},
		"complete": {
			Name:     "done",
			Complete: api.NewOptFlowDefinitionStepComplete("vanish"),
		},
		"on_success": {
			Name:      "register",
			OnSuccess: api.NewOptFlowDefinitionStepOnSuccess("delete_user"),
		},
	}
	for name, step := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			steps, err := StepsFromAPI([]api.FlowDefinitionStep{step})
			require.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(nil, nil))
			assert.Nil(t, steps)
		})
	}
}

func TestStepsFromAPI_KeepsAbsentValuesAbsent(t *testing.T) {
	t.Parallel()

	steps, err := StepsFromAPI([]api.FlowDefinitionStep{
		{
			Name: "omitted",
			Gates: api.NewOptFlowDefinitionStepGates(api.FlowDefinitionStepGates{
				"bot_check": {Kind: api.GateKindCaptcha, Provider: "example"},
			}),
			Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
				"next": {
					Target:  api.NewOptString("explicit"),
					Action:  api.OptNilFlowDefinitionStepTransitionsItemAction{Set: true, Null: true},
					Purpose: api.OptNilFlowDefinitionStepTransitionsItemPurpose{Set: true, Null: true},
				},
			}),
		},
		{Name: "explicit", Actions: []api.StepAction{}},
	})
	require.NoError(t, err)
	require.Len(t, steps, 2)

	omitted := steps[0]
	assert.Nil(t, omitted.Actions, "omitted actions stay nil")
	assert.Nil(t, omitted.Gates["bot_check"].Config, "an absent gate config stays nil, as storage reads it back")
	assert.Nil(t, omitted.Transitions["next"].Action, "an explicit null action is no action")
	assert.Nil(t, omitted.Transitions["next"].Purpose, "an explicit null purpose is no purpose")
	assert.Nil(t, omitted.Complete)
	assert.Nil(t, omitted.OnSuccess)

	explicit := steps[1]
	assert.NotNil(t, explicit.Actions, "an explicit empty action list stays empty")
	assert.Empty(t, explicit.Actions)
	assert.Nil(t, explicit.Gates)
	assert.Nil(t, explicit.Transitions)
}

func TestStepsFromAPI_MapsEveryField(t *testing.T) {
	t.Parallel()

	steps, err := StepsFromAPI([]api.FlowDefinitionStep{{
		Name:   "register",
		Fields: []string{"email", "x-auth-methods#password"},
		Actions: []api.StepAction{{
			Name:    "submit",
			Kind:    api.StepActionKindSubmit,
			Primary: api.NewOptBool(true),
			TextKey: api.NewOptString("register.submit"),
		}},
		Gates: api.NewOptFlowDefinitionStepGates(api.FlowDefinitionStepGates{
			"bot_check": {
				Kind:     api.GateKindCaptcha,
				Provider: "example",
				Config:   api.NewOptGateConfig(api.GateConfig{"threshold": jx.Raw("0.5")}),
			},
		}),
		SSOProviders: []string{"google"},
		OnSuccess:    api.NewOptFlowDefinitionStepOnSuccess(api.FlowDefinitionStepOnSuccessCreateUser),
		Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
			"sign_in": {Purpose: api.NewOptNilFlowDefinitionStepTransitionsItemPurpose(api.FlowDefinitionStepTransitionsItemPurposeLogin)},
			"other":   {Target: api.NewOptString("login"), Action: api.NewOptNilFlowDefinitionStepTransitionsItemAction(api.FlowDefinitionStepTransitionsItemActionSwitch)},
		}),
	}, {
		Name:     "done",
		Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
	}})
	require.NoError(t, err)

	login := domain.FlowDefinitionPurposeLogin
	switchFlow := domain.Switch
	createUser := domain.FlowOnSuccessCreateUser
	redirect := domain.FlowStepCompleteRedirect
	assert.Equal(t, []domain.FlowDefinitionStep{{
		Name:    "register",
		Fields:  []domain.Field{"email", "x-auth-methods#password"},
		Actions: []domain.FlowStepAction{{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true, TextKey: "register.submit"}},
		Gates: map[string]domain.FlowStepGate{
			"bot_check": {Kind: domain.FlowGateKindCaptcha, Provider: "example", Config: map[string]any{"threshold": 0.5}},
		},
		SSOProviders: []string{"google"},
		OnSuccess:    &createUser,
		Transitions: map[string]domain.FlowStepTransition{
			"sign_in": {Purpose: &login},
			"other":   {Target: "login", Action: &switchFlow},
		},
	}, {
		Name:     "done",
		Complete: &redirect,
	}}, steps)
}

func TestAudienceFromAPI(t *testing.T) {
	t.Parallel()

	assert.Equal(t, domain.FlowDefinitionAudience{}, AudienceFromAPI(api.OptFlowAudience{}))
	assert.Equal(t,
		domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}, TeamIDs: []string{"team-1"}},
		AudienceFromAPI(api.NewOptFlowAudience(api.FlowAudience{AppIds: []string{"app-1"}, TeamIds: []string{"team-1"}})),
	)
}

// The loader refuses a shipped document the API would refuse, and with the
// same error.
func TestFromDocument_RefusesUnknownPurpose(t *testing.T) {
	t.Parallel()

	_, err := fromDocument([]byte(`{
		"name": "broken",
		"user_schema": "human-user",
		"purposes": {"vacation": "done"},
		"steps": [{"name": "done", "complete": "redirect"}]
	}`), "https://example.com", "proj_broken")
	require.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(nil, nil))
}
