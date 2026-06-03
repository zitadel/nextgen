//go:build postgres_integration

package integration_test

import (
	"strings"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

func TestCreateProjectDefaultLoginFlowRegistrationHandoff(t *testing.T) {
	client := harness.EnsureAnonymousAPIClient(t)

	projectResp, err := client.CreateProject(t.Context(), &api.CreateProjectRequest{
		PreviewOrigins: make([]string, 0),
	})
	require.NoError(t, err)
	project, ok := projectResp.(*api.CreateProjectResponse)
	require.True(t, ok, helpers.MustMarshal(t, projectResp))

	flowResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	flow, ok := flowResp.(*api.FlowResponseHeaders)
	require.True(t, ok, helpers.MustMarshal(t, flowResp))

	email := "fresh@example.test"
	password := "Correct-Horse-42!"

	afterIdentifierResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + email + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flow.Response.ID,
		Zflow: zflowCookieValue(t, flow.SetCookie.Value),
	})
	require.NoError(t, err)
	afterIdentifier, ok := afterIdentifierResp.(*api.SubmitFlowStepOK)
	require.True(t, ok, helpers.MustMarshal(t, afterIdentifierResp))
	assert.Equal(t, "register", afterIdentifier.Response.Step.Name)
	assert.Contains(t, afterIdentifier.Response.Step.Fields, "password")

	doneResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email":    jx.Raw(`"` + email + `"`),
			"password": jx.Raw(`"` + password + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    afterIdentifier.Response.ID,
		Zflow: zflowCookieValue(t, afterIdentifier.SetCookie.Value),
	})
	require.NoError(t, err)
	done, ok := doneResp.(*api.SubmitFlowStepOK)
	require.True(t, ok, helpers.MustMarshal(t, doneResp))
	assert.Equal(t, "done", done.Response.Step.Name)
	assert.NotEmpty(t, done.Response.HandoffToken.Value)
	assert.True(t, done.Response.HandoffTokenExpiresAt.Set)

	exchangeResp, err := client.ExchangeHandoff(t.Context(), &api.ExchangeRequest{
		HandoffToken: done.Response.HandoffToken.Value,
	}, api.ExchangeHandoffParams{
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	exchanged, ok := exchangeResp.(*api.SessionWithTokenResponseHeaders)
	require.True(t, ok, helpers.MustMarshal(t, exchangeResp))
	assert.Contains(t, exchanged.SetCookie, "__nextgen_session=")
	assert.NotEmpty(t, exchanged.Response.SessionToken)
	assert.Equal(t, api.ProjectID(project.ID), exchanged.Response.Session.ProjectID)
	assert.Equal(t, api.SessionResponseStateActive, exchanged.Response.Session.State)
	assert.NotEmpty(t, exchanged.Response.Session.UserID.Value)
}

func zflowCookieValue(t *testing.T, setCookie string) string {
	t.Helper()
	pair := strings.Split(setCookie, ";")[0]
	name, value, ok := strings.Cut(pair, "=")
	require.True(t, ok, "set-cookie did not contain a cookie pair: %q", setCookie)
	require.Equal(t, "_zflow", name)
	require.NotEmpty(t, value)
	return value
}
