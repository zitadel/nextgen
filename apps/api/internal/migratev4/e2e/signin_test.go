//go:build postgres_integration

package e2e_test

import (
	"encoding/json"
	"net/http"
	"slices"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

// loginOrigin is the app the sign-ins start on.
const loginOrigin = "https://login.acme.test"

// flow is a started login flow: its id, its cookie and its attempt.
type flow struct {
	id        string
	zflow     string
	attemptID string
}

// client is an API client holding the migrated project's secret.
func (m *migration) client() *helpers.ApiClient {
	m.t.Helper()
	client, err := helpers.NewApiClient(m.api.EnsureTestServer(m.t).URL)
	require.NoError(m.t, err)
	project, err := m.api.EnsureProjectService(m.t).Get(m.t.Context(), m.projectID(), service.ProjectQueryOptions{})
	require.NoError(m.t, err)
	m.api.SetProjectSecretOnApiClient(m.t, client, project)
	return client
}

// startFlow starts the project's login flow, the migrated one, and returns
// the entry step.
func (m *migration) startFlow(client *helpers.ApiClient) (*flow, api.FlowResponse) {
	m.t.Helper()
	resp, err := client.CreateFlow(m.t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(m.projectID()),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	}, api.CreateFlowParams{})
	require.NoError(m.t, err)
	require.IsType(m.t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(m.t, resp))
	created := resp.(*api.FlowResponseHeaders)
	f := &flow{id: created.Response.ID}
	f.zflow = zflowCookie(m.t, created.SetCookie)
	f.attemptID = m.flowState(f.zflow).AuthAttemptID
	return f, created.Response
}

// submit submits action with fields on the flow's current step and carries
// the cookie over. A refused submission comes back as the step again.
func (m *migration) submit(client *helpers.ApiClient, f *flow, req *api.FlowSubmitRequest) api.FlowResponse {
	m.t.Helper()
	resp, err := client.SubmitFlowStep(m.t.Context(), req, api.SubmitFlowStepParams{ID: f.id, Zflow: f.zflow})
	require.NoError(m.t, err)
	var got *api.FlowResponseHeaders
	switch r := resp.(type) {
	case *api.SubmitFlowStepOK:
		got = (*api.FlowResponseHeaders)(r)
	case *api.SubmitFlowStepBadRequest:
		got = (*api.FlowResponseHeaders)(r)
	default:
		require.Failf(m.t, "not a step response", "%s", helpers.MustMarshal(m.t, resp))
	}
	for _, c := range (&http.Response{Header: http.Header{"Set-Cookie": got.SetCookie}}).Cookies() {
		if c.Name == "_zflow" && c.Value != "" && c.MaxAge >= 0 {
			f.zflow = c.Value
		}
	}
	return got.Response
}

func fields(t require.TestingT, values map[string]string) api.OptFlowSubmitRequestFields {
	raw := api.FlowSubmitRequestFields{}
	for name, value := range values {
		encoded, err := json.Marshal(value)
		require.NoError(t, err)
		raw[name] = jx.Raw(encoded)
	}
	return api.NewOptFlowSubmitRequestFields(raw)
}

// signIn signs in through the migrated login flow over HTTP, as
// <zitadel-login> drives it: the identifier on the entry step, then the
// password. It returns the nextgen user the flow authenticated, or "" with
// the step the flow stopped on.
func (m *migration) signIn(identifierField, identifier, password string) (userID, stoppedOn string) {
	m.t.Helper()
	client := m.client()
	f, step := m.startFlow(client)
	require.True(m.t, slices.ContainsFunc(step.Step.Fields, func(f api.Field) bool { return f.Name == identifierField }),
		"the entry step %q asks for %s", step.Step.Name, identifierField)
	step = m.submit(client, f, &api.FlowSubmitRequest{Action: "submit", Fields: fields(m.t, map[string]string{identifierField: identifier})})
	if step.Step.Name != "password" {
		return "", step.Step.Name
	}
	step = m.submit(client, f, &api.FlowSubmitRequest{Action: "submit", Fields: fields(m.t, map[string]string{"x-auth-methods#password": password})})
	if !step.Step.Complete.Set {
		return "", step.Step.Name
	}
	require.True(m.t, step.HandoffToken.Set, "a completed sign-in hands off to the app")
	return m.authenticatedUser(f), step.Step.Name
}

// authenticatedUser is the user the flow's attempt verified.
func (m *migration) authenticatedUser(f *flow) string {
	m.t.Helper()
	attempt, err := m.api.EnsureServiceDB(m.t).Statements().GetAuthAttemptByID(m.t.Context(), m.projectID(), f.attemptID)
	require.NoError(m.t, err)
	user, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	require.True(m.t, ok, "the attempt verified a user")
	return user.UserID
}

// flowState opens the sealed flow cookie, as the server does.
func (m *migration) flowState(zflow string) domain.FlowState {
	m.t.Helper()
	crypter, err := m.api.EnsureKeyService(m.t).GetProjectCrypter(m.t.Context(), m.projectID(), domain.EncryptionKeyPurposeCookie)
	require.NoError(m.t, err)
	payload, err := crypter.Decrypt(zflow)
	require.NoError(m.t, err)
	var state domain.FlowState
	require.NoError(m.t, json.Unmarshal([]byte(payload), &state))
	return state
}

func zflowCookie(t require.TestingT, setCookie []string) string {
	for _, c := range (&http.Response{Header: http.Header{"Set-Cookie": setCookie}}).Cookies() {
		if c.Name == "_zflow" {
			return c.Value
		}
	}
	require.Fail(t, "no _zflow cookie", "%q", setCookie)
	return ""
}

// offers reports whether the step offers the SSO provider slug.
func offers(step api.FlowResponse, slug string) bool {
	return slices.ContainsFunc(step.Step.SSOProviders, func(p api.SSOProvider) bool { return p.ID == slug })
}
