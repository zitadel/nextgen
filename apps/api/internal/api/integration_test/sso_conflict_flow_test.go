//go:build postgres_integration || spanner_integration

package integration_test

import (
	"fmt"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	api "go.zitadel.com/zitadel/v5/api"
)

// Like the resolution tests these run sequentially: each one creates a
// project, a connection and users.

// ssoConflictFlowDefinition is modelled on the flow `zitadel auth-method sso
// enable` writes for a password schema
// (docs/design/idp/schemas/default-login.scaffold.json), pruned to what these
// tests walk: every user_already_exists, from a provider or a typed sign-up,
// routes to sso-conflict. It leaves out register-sso and the
// sso_user_not_found routes, which a bound attempt never reaches.
const ssoConflictFlowDefinition = `{
	"name": "sso-conflict-login",
	"status": "active",
	"user_schema": %q,
	"purposes": {"login": "identifier", "register": "register"},
	"steps": [
		{
			"name": "identifier",
			"fields": ["email"],
			"sso_providers": ["google"],
			"actions": [
				{"name": "submit", "kind": "submit", "primary": true},
				{"name": "register", "kind": "navigate"}
			],
			"transitions": {
				"submit": {"target": "password"},
				"register": {"target": "register", "purpose": "register"},
				"user_not_found": {"target": "register"},
				"sso_authenticated": {"target": "done"},
				"user_already_exists": {"target": "sso-conflict"}
			}
		},
		{
			"name": "password",
			"fields": ["x-auth-methods#password"],
			"actions": [{"name": "submit", "kind": "submit", "primary": true}],
			"transitions": {"submit": {"target": "done"}}
		},
		{
			"name": "register",
			"fields": ["email"],
			"actions": [
				{"name": "submit", "kind": "submit", "primary": true},
				{"name": "sign_in", "kind": "navigate"}
			],
			"transitions": {
				"submit": {"target": "register-password"},
				"sign_in": {"target": "identifier", "purpose": "login"},
				"user_already_exists": {"target": "sso-conflict"}
			}
		},
		{
			"name": "register-password",
			"fields": ["x-auth-methods#password"],
			"on_success": "create_user",
			"actions": [{"name": "submit", "kind": "submit", "primary": true}],
			"transitions": {
				"submit": {"target": "done"},
				"user_already_exists": {"target": "sso-conflict"}
			}
		},
		{
			"name": "sso-conflict",
			"fields": ["x-auth-methods#password"],
			"sso_providers": ["google"],
			"actions": [
				{"name": "submit", "kind": "submit", "primary": true},
				{"name": "passkey", "kind": "passkey"},
				{"name": "sign_in", "kind": "navigate"}
			],
			"transitions": {
				"submit": {"target": "done"},
				"passkey": {"target": "done"},
				"sso_authenticated": {"target": "done"},
				"user_already_exists": {"target": "sso-conflict"},
				"sign_in": {"target": "identifier", "purpose": "login"}
			}
		},
		{"name": "done", "complete": "show"}
	]
}`

func newSSOConflictFixture(t *testing.T) *ssoResolutionFixture {
	t.Helper()
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	var def api.FlowDefinition
	require.NoError(t, def.UnmarshalJSON(fmt.Appendf(nil, ssoConflictFlowDefinition, defaultSchemaURL())))
	resp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      f.projectID(),
		FlowDefinition: def,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, resp, helpers.MustMarshal(t, resp))
	f.definitionName = "sso-conflict-login"
	return f
}

// submitAction submits action, with fields when they are not nil, and returns
// the response.
func (f *ssoResolutionFixture) submitAction(t *testing.T, flow ssoFlow, action string, fields map[string]string) api.SubmitFlowStepRes {
	t.Helper()
	req := &api.FlowSubmitRequest{Action: action}
	if fields != nil {
		raw := api.FlowSubmitRequestFields{}
		for name, value := range fields {
			raw[name] = jx.Raw(helpers.MustMarshal(t, value))
		}
		req.Fields = api.NewOptFlowSubmitRequestFields(raw)
	}
	resp, err := f.client.SubmitFlowStep(t.Context(), req, api.SubmitFlowStepParams{ID: flow.id, Zflow: flow.zflow})
	require.NoError(t, err)
	return resp
}

// advance requires a step response, carries its cookie over to flow and
// returns the step.
func advance(t *testing.T, flow *ssoFlow, resp any) api.FlowResponse {
	t.Helper()
	var got *api.FlowResponseHeaders
	switch r := resp.(type) {
	case *api.FlowResponseHeaders:
		got = r
	case *api.SubmitFlowStepOK:
		got = (*api.FlowResponseHeaders)(r)
	case *api.SubmitFlowStepBadRequest:
		got = (*api.FlowResponseHeaders)(r)
	default:
		require.Failf(t, "not a step response", "%s", helpers.MustMarshal(t, resp))
	}
	if len(got.SetCookie) > 0 {
		flow.zflow = mustExtractZflow(t, got.SetCookie)
	}
	return got.Response
}

func hasBackAction(step api.FlowStep) bool {
	for _, a := range step.Actions {
		if a.Kind == api.FlowStepActionKindBack {
			return true
		}
	}
	return false
}

// toConflict lands a flow on the conflict step: a provider identity whose
// email ownerID holds, with no link. It returns the flow, the rendered step,
// the owner and the colliding email.
func (f *ssoResolutionFixture) toConflict(t *testing.T) (ssoFlow, api.FlowResponse, string, string) {
	t.Helper()
	email := helpers.RandString(8) + "@example.com"
	ownerID := "user_" + helpers.RandString(8)
	createAttemptUser(t, f.project, f.team, defaultSchemaURL(), ownerID, map[string]string{"email": email})
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{"email": email}, map[string]bool{"email": true})
	conflict := advance(t, &flow, f.getStep(t, flow))
	require.Equal(t, "sso-conflict", conflict.Step.Name)
	return flow, conflict, ownerID, email
}

// A provider identity whose email an existing account holds lands on the
// conflict step bound to that account. Its password signs in, the step shows
// nothing about the account beyond the colliding value, and the provider
// identity stays unlinked.
func TestSSOConflictProviderCollisionSignsInWithoutLinking(t *testing.T) {
	f := newSSOConflictFixture(t)
	flow, conflict, ownerID, _ := f.toConflict(t)
	setAttemptPassword(t, f.project, ownerID, "correct-horse-battery-staple")
	require.Len(t, conflict.Step.Fields, 1)
	assert.Equal(t, "x-auth-methods#password", conflict.Step.Fields[0].Name)
	assert.NotContains(t, helpers.MustMarshal(t, conflict), ownerID, "the step must not disclose the account")

	wrong := advance(t, &flow, f.submitAction(t, flow, "submit", map[string]string{"x-auth-methods#password": "not-the-password"}))
	assert.Equal(t, "sso-conflict", wrong.Step.Name)
	assert.Equal(t, "error.invalid_credentials", wrong.Step.Error.Value)

	done := advance(t, &flow, f.submitAction(t, flow, "submit", map[string]string{"x-auth-methods#password": "correct-horse-battery-staple"}))
	assert.Equal(t, "done", done.Step.Name)
	assert.True(t, done.HandoffToken.Set)

	_, err := f.linkFor(t, "sub-new")
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "a conflict sign-in links nothing")
}

// A typed sign-up that collides lands on the conflict step. sign_in releases
// the account; back from identifier returns to the conflict step with nobody
// bound, where a password asks the person to sign in and returns no API error.
func TestSSOConflictBackAfterSignInAsksToSignIn(t *testing.T) {
	f := newSSOConflictFixture(t)
	email := helpers.RandString(8) + "@example.com"
	createAttemptUser(t, f.project, f.team, defaultSchemaURL(), "user_"+helpers.RandString(8), map[string]string{"email": email})
	flow := f.startFlow(t, nil)

	register := advance(t, &flow, f.submitAction(t, flow, "register", nil))
	require.Equal(t, "register", register.Step.Name)
	conflict := advance(t, &flow, f.submitAction(t, flow, "submit", map[string]string{"email": email}))
	require.Equal(t, "sso-conflict", conflict.Step.Name)

	identifier := advance(t, &flow, f.submitAction(t, flow, "sign_in", nil))
	require.Equal(t, "identifier", identifier.Step.Name)
	require.True(t, hasBackAction(identifier.Step))

	back := advance(t, &flow, f.submitAction(t, flow, "back", nil))
	require.Equal(t, "sso-conflict", back.Step.Name)

	resp := f.submitAction(t, flow, "submit", map[string]string{"x-auth-methods#password": "correct-horse-battery-staple"})
	require.IsType(t, &api.SubmitFlowStepBadRequest{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.SubmitFlowStepBadRequest).Response
	assert.Equal(t, "sso-conflict", got.Step.Name)
	assert.Equal(t, "error.sign_in_first", got.Step.Error.Value)
	assert.False(t, got.HandoffToken.Set)
}

// The provider button on the conflict step resolves under the bound-attempt
// invariant: the bound user's own identity signs in, another identity
// colliding with her shows the step again, and everything else restarts
// without creating or switching users.
func TestSSOConflictProviderButtonOnBoundAttempt(t *testing.T) {
	f := newSSOConflictFixture(t)

	t.Run("identity linked to the bound user signs in", func(t *testing.T) {
		flow, _, ownerID, email := f.toConflict(t)
		f.link(t, f.connection.ID, "sub-owner-"+ownerID, ownerID)
		parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-owner-"+ownerID, map[string]any{"email": email}, map[string]bool{"email": true})

		requireAuthenticated(t, f.getStep(t, flow))
	})

	t.Run("unknown identity colliding with the bound user shows the step again", func(t *testing.T) {
		flow, _, ownerID, email := f.toConflict(t)
		firstCheck := openFlowState(t, f.project.ID, flow.zflow).SSOResolvedCheckID
		parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-other-"+ownerID, map[string]any{"email": email}, map[string]bool{"email": true})

		again := advance(t, &flow, f.getStep(t, flow))
		assert.Equal(t, "sso-conflict", again.Step.Name)
		assert.NotEqual(t, firstCheck, openFlowState(t, f.project.ID, flow.zflow).SSOResolvedCheckID, "the second identity was resolved, not the first re-rendered")
		assert.False(t, again.HandoffToken.Set)
		_, err := f.linkFor(t, "sub-other-"+ownerID)
		require.ErrorAs(t, err, new(*database.NoRowFoundError), "a repeated collision links nothing")
	})

	t.Run("identity linked to another user restarts", func(t *testing.T) {
		flow, _, ownerID, _ := f.toConflict(t)
		otherID := f.createUser(t, defaultSchemaURL())
		f.link(t, f.connection.ID, "sub-linked-"+otherID, otherID)
		parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-linked-"+otherID, emailClaims(), nil)

		resp := f.getStep(t, flow)
		require.IsType(t, &api.GetFlowStepConflict{}, resp, helpers.MustMarshal(t, resp))
		userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, ownerID, userFactor.UserID, "the attempt still carries the bound user")
	})

	t.Run("unknown identity without a collision restarts and creates nothing", func(t *testing.T) {
		flow, _, _, _ := f.toConflict(t)
		fresh := helpers.RandString(8) + "@example.com"
		parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-fresh-"+fresh, map[string]any{"email": fresh}, map[string]bool{"email": true})

		resp := f.getStep(t, flow)
		require.IsType(t, &api.GetFlowStepConflict{}, resp, helpers.MustMarshal(t, resp))
		_, err := f.userByEmail(t, fresh)
		require.ErrorAs(t, err, new(*database.NoRowFoundError), "a bound attempt creates no user")
		_, err = f.linkFor(t, "sub-fresh-"+fresh)
		require.ErrorAs(t, err, new(*database.NoRowFoundError))
	})
}
