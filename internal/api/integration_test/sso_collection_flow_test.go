//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// These tests resolve an unlinked identity into the register-sso step through
// GET /flow/{id}, then submit that step. Like the resolution tests they run
// sequentially.

// ssoCollectionFixture is an sso resolution fixture whose flows start on a
// definition that collects an unlinked identity on register-sso.
type ssoCollectionFixture struct {
	*ssoResolutionFixture
	schemaURL string
}

func newSSOCollectionFixture(t *testing.T) *ssoCollectionFixture {
	t.Helper()
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	// username is required and no provider sends it, so every identity is
	// collected. dependentRequired holds only on the whole user.
	schemaURL := harness.CreateUserSchema(t, f.project, `{
		"title": "SSOCollectionUser",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://sso-collection.example.com/schemas/user.json",
		"kind": "user-schema",
		"type": "object",
		"x-identifier": "email",
		"x-auth-methods": {"password": {"enabled": true}},
		"required": ["email", "username"],
		"properties": {
			"email":      {"type": "string", "format": "email", "x-unique": "project"},
			"username":   {"type": "string", "minLength": 3, "x-unique": "project"},
			"givenName":  {"type": "string", "maxLength": 10},
			"familyName": {"type": "string", "maxLength": 10},
			"badge":      {"type": "string", "x-unique": "team"},
			"country":    {"type": "string"},
			"zip":        {"type": "string"}
		},
		"dependentRequired": {"country": ["zip"]}
	}`)
	submit := api.StepAction{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)}
	defResp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: f.projectID(),
		FlowDefinition: api.FlowDefinition{
			Name:       "sso-collection",
			Status:     "active",
			UserSchema: schemaURL,
			Purposes:   api.FlowDefinitionPurposes{"login": "identifier"},
			Steps: []api.FlowDefinitionStep{
				{
					Name:         "identifier",
					Fields:       []string{"email"},
					SSOProviders: []string{"google"},
					Actions:      []api.StepAction{submit},
					Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
						"submit":              api.FlowDefinitionStepTransitionsItem{Target: "done"},
						"sso_authenticated":   api.FlowDefinitionStepTransitionsItem{Target: "done"},
						"user_already_exists": api.FlowDefinitionStepTransitionsItem{Target: "identifier"},
						"sso_user_not_found":  api.FlowDefinitionStepTransitionsItem{Target: "register-sso"},
					}),
				},
				{
					Name:      "register-sso",
					Fields:    []string{"email", "username", "country", "zip", "badge"},
					OnSuccess: api.NewOptFlowDefinitionStepOnSuccess(api.FlowDefinitionStepOnSuccessCreateUserWithSSO),
					Actions:   []api.StepAction{submit},
					Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
						"submit":              api.FlowDefinitionStepTransitionsItem{Target: "done"},
						"user_already_exists": api.FlowDefinitionStepTransitionsItem{Target: "identifier"},
					}),
				},
				{
					Name:     "done",
					Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
				},
			},
		},
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))
	f.definitionName = "sso-collection"
	return &ssoCollectionFixture{ssoResolutionFixture: f, schemaURL: schemaURL}
}

// collectionClaims is a verified email and two names the step does not show;
// familyName is too long for its property.
func collectionClaims() (map[string]any, map[string]bool) {
	return map[string]any{"email": "alice@example.com", "givenName": "Alice", "familyName": "Longer-Than-Ten"},
		map[string]bool{"email": true}
}

// collect resolves subject into register-sso and returns the flow with the
// rotated cookie and the rendered step.
func (f *ssoCollectionFixture) collect(t *testing.T, subject string) (ssoFlow, api.FlowStep) {
	t.Helper()
	flow := f.startFlow(t, "")
	claims, verified := collectionClaims()
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, subject, claims, verified)
	resp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.FlowResponseHeaders)
	require.Equal(t, "register-sso", got.Response.Step.Name)
	flow.zflow = mustExtractZflow(t, got.SetCookie)
	return flow, got.Response.Step
}

func (f *ssoCollectionFixture) submit(t *testing.T, flow ssoFlow, fields map[string]string) api.SubmitFlowStepRes {
	t.Helper()
	raw := api.FlowSubmitRequestFields{}
	for name, value := range fields {
		raw[name] = jx.Raw(`"` + value + `"`)
	}
	resp, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(raw),
	}, api.SubmitFlowStepParams{ID: flow.id, Zflow: flow.zflow})
	require.NoError(t, err)
	return resp
}

// requireStepError asserts the submit kept the flow on register-sso with
// stepError, and created, bound and linked nothing.
func (f *ssoCollectionFixture) requireStepError(t *testing.T, flow ssoFlow, resp api.SubmitFlowStepRes, subject, stepError string) {
	t.Helper()
	require.IsType(t, &api.SubmitFlowStepBadRequest{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.SubmitFlowStepBadRequest).Response
	assert.Equal(t, "register-sso", got.Step.Name)
	assert.Equal(t, stepError, got.Step.Error.Value)
	assert.False(t, got.HandoffToken.Set)
	attempt := f.attempt(t, flow)
	_, bound := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	assert.False(t, bound, "nobody is bound")
	_, parked := attempt.SSOCallback()
	assert.True(t, parked, "the parked row stays for the next submit")
	_, err := f.linkFor(t, subject)
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "nothing is linked")
}

func TestSSOCollectionSubmitCreatesUserAndLinkAtomically(t *testing.T) {
	f := newSSOCollectionFixture(t)
	flow, step := f.collect(t, "sub-new")
	prefill := map[string]string{}
	for _, field := range step.Fields {
		prefill[field.Name] = string(field.Value)
	}
	assert.Equal(t, `"alice@example.com"`, prefill["email"], "the step is prefilled with the provider's email")

	resp := f.submit(t, flow, map[string]string{"email": "alice@example.com", "username": "alice"})

	require.IsType(t, &api.SubmitFlowStepOK{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.SubmitFlowStepOK).Response
	assert.Equal(t, "done", got.Step.Name)
	assert.True(t, got.HandoffToken.Set, "the created user signs in")
	user, err := f.userByEmail(t, "alice@example.com")
	require.NoError(t, err)
	assert.Equal(t, f.schemaURL, user.SchemaURL)
	attrs, err := user.Attributes.ToMap()
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"email": "alice@example.com", "username": "alice", "givenName": "Alice"}, attrs,
		"the typed values and the hidden claim that fits its property; familyName is dropped")
	link, err := f.linkFor(t, "sub-new")
	require.NoError(t, err)
	assert.Equal(t, user.ID, link.UserID)
	attempt := f.attempt(t, flow)
	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, user.ID, userFactor.UserID)
	ssoFactor, ok := domain.CheckAs[*domain.AuthFactorSSO](attempt, domain.AuthCheckTypeSSO)
	require.True(t, ok)
	assert.Equal(t, link.ID, ssoFactor.LinkID)
	_, parked := attempt.SSOCallback()
	assert.False(t, parked, "the parked row is deleted")

	// A double submit with the same cookie: the attempt is handed off, so the
	// flow restarts instead of creating a second user.
	again := f.submit(t, flow, map[string]string{"email": "alice@example.com", "username": "alice"})
	require.IsType(t, &api.ErrorDetails{}, again, helpers.MustMarshal(t, again))
	assert.Equal(t, "flow.restart_required", string(again.(*api.ErrorDetails).Code))
}

// An edited address the provider did not verify would get an account linked
// to the editor's provider subject.
func TestSSOCollectionSubmitEditedVerifiedEmailIsRefused(t *testing.T) {
	f := newSSOCollectionFixture(t)
	flow, _ := f.collect(t, "sub-new")

	resp := f.submit(t, flow, map[string]string{"email": "mallory@example.com", "username": "mallory"})

	f.requireStepError(t, flow, resp, "sub-new", domain.FlowStepErrorSSOVerifiedUniqueValueChanged)
	for _, email := range []string{"alice@example.com", "mallory@example.com"} {
		_, err := f.userByEmail(t, email)
		require.ErrorAs(t, err, new(*database.NoRowFoundError), "no user holds %s", email)
	}
}

// A typed unique value another user holds binds that user, as a collision on
// the render does: the owner then signs in on the identifier step. The new
// user has no team, so a team-unique value of a user with no team collides as
// a project-unique one does.
func TestSSOCollectionSubmitTypedCollisionBindsOwner(t *testing.T) {
	for name, tc := range map[string]struct {
		createOwner func(t *testing.T, f *ssoCollectionFixture, id string)
		fields      map[string]string
	}{
		"username": {
			createOwner: func(t *testing.T, f *ssoCollectionFixture, id string) {
				createAttemptUser(t, f.project, f.team, f.schemaURL, id, map[string]string{"email": "owner@example.com", "username": "taken"})
			},
			fields: map[string]string{"email": "alice@example.com", "username": "taken"},
		},
		"team-unique value of a user without a team": {
			createOwner: func(t *testing.T, f *ssoCollectionFixture, id string) {
				created := make(domain.CreateAttributes, 0, 3)
				for _, attr := range []struct {
					key    domain.AttributeKey
					value  string
					unique domain.AttributeUniqueness
				}{
					{"email", "owner@example.com", domain.AttributeUniquenessProject},
					{"username", "owner", domain.AttributeUniquenessProject},
					{"badge", "b-1", domain.AttributeUniquenessTeam},
				} {
					a, err := domain.NewCreateAttribute(attr.key, attr.value, attr.unique)
					require.NoError(t, err)
					created = append(created, *a)
				}
				require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
					ProjectID:  f.project.ID,
					SchemaURL:  f.schemaURL,
					ID:         id,
					Attributes: created,
				}))
			},
			fields: map[string]string{"email": "alice@example.com", "username": "alice", "badge": "b-1"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newSSOCollectionFixture(t)
			ownerID := "user_" + helpers.RandString(8)
			tc.createOwner(t, f, ownerID)
			flow, _ := f.collect(t, "sub-new")

			resp := f.submit(t, flow, tc.fields)

			require.IsType(t, &api.SubmitFlowStepOK{}, resp, helpers.MustMarshal(t, resp))
			got := resp.(*api.SubmitFlowStepOK).Response
			assert.Equal(t, "identifier", got.Step.Name)
			assert.False(t, got.HandoffToken.Set, "the owner still has to prove a factor")
			attempt := f.attempt(t, flow)
			userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
			require.True(t, ok)
			assert.Equal(t, ownerID, userFactor.UserID)
			_, hasSSO := domain.CheckAs[*domain.AuthFactorSSO](attempt, domain.AuthCheckTypeSSO)
			assert.False(t, hasSSO, "a collision proves nothing about the account")
			_, err := f.linkFor(t, "sub-new")
			require.ErrorAs(t, err, new(*database.NoRowFoundError), "a collision links nothing")
			_, err = f.userByEmail(t, "alice@example.com")
			require.ErrorAs(t, err, new(*database.NoRowFoundError), "no user is created")
		})
	}
}

// Each field passes on its own; the user fails only as a whole, and zip is on
// the step, so the user can fix it.
func TestSSOCollectionSubmitInvalidUserShowsStepError(t *testing.T) {
	f := newSSOCollectionFixture(t)
	flow, _ := f.collect(t, "sub-new")

	resp := f.submit(t, flow, map[string]string{"email": "alice@example.com", "username": "alice", "country": "DE"})

	f.requireStepError(t, flow, resp, "sub-new", domain.FlowStepErrorSSOUserInvalid)
	_, err := f.userByEmail(t, "alice@example.com")
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "no user is created")

	// The rotated cookie still holds the row, so the corrected submit creates
	// the user.
	flow.zflow = mustExtractZflow(t, resp.(*api.SubmitFlowStepBadRequest).SetCookie)
	fixed := f.submit(t, flow, map[string]string{"email": "alice@example.com", "username": "alice", "country": "DE", "zip": "10115"})
	require.IsType(t, &api.SubmitFlowStepOK{}, fixed, helpers.MustMarshal(t, fixed))
	assert.Equal(t, "done", fixed.(*api.SubmitFlowStepOK).Response.Step.Name)
}
