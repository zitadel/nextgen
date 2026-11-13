//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestUnknownIdentifierEvents pins what an identifier that matches no account
// writes. A sign-up asks whether its email is free, so a free one is no
// failed check. A sign-in with an unknown email is a failed sign-in, and
// writes one.
func TestUnknownIdentifierEvents(t *testing.T) {
	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	// run gives fields to the first step of a flow for purpose, in a claimed
	// project of its own, and returns the step it answers and the check
	// types of the project's auth.check.failed and auth.check.succeeded.
	run := func(t *testing.T, purpose api.CreateFlowRequestPurpose, fields api.FlowSubmitRequestFields) (step string, failed, succeeded []string) {
		t.Helper()
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: helpers.TeamName()})
		require.NoError(t, err)
		// A claimed project: its events are listed.
		harness.SeedOwningTeam(t, project.ID, team.ID)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, client, project)
		for _, definition := range []api.FlowDefinition{
			passwordRegisterFlowDefinition(schemaURL),
			passwordLoginFlowWithNotFoundFlowDefinition(schemaURL),
		} {
			defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
				ProjectID:      api.ProjectID(project.ID),
				FlowDefinition: definition,
			})
			require.NoError(t, err)
			require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))
		}
		deployPrimary(t, project.ID)

		createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
			ProjectID: api.ProjectID(project.ID),
			Purpose:   purpose,
		}, api.CreateFlowParams{})
		require.NoError(t, err)
		require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
		flow := createResp.(*api.FlowResponseHeaders)
		zflow := mustExtractZflow(t, flow.SetCookie)
		request := &api.FlowSubmitRequest{Action: "submit", Fields: api.NewOptFlowSubmitRequestFields(fields)}
		if purpose == api.CreateFlowRequestPurposeRegister {
			request.GateProofs = currentSignupProofs(t, client, flow.Response.ID, zflow)
		}
		resp, err := client.SubmitFlowStep(t.Context(), request, api.SubmitFlowStepParams{ID: flow.Response.ID, Zflow: zflow})
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepOK{}, resp, helpers.MustMarshal(t, resp))
		step = resp.(*api.SubmitFlowStepOK).Response.Step.Name

		listed, err := client.ListEvents(t.Context(), api.ListEventsParams{
			ProjectID: api.ProjectID(project.ID),
			Category:  []api.ListEventsCategoryItem{api.ListEventsCategoryItemAuth},
		})
		require.NoError(t, err)
		page, ok := listed.(*api.ListEventsResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		require.False(t, page.NextPageToken.IsSet(), "one flow's events fit one page")
		for _, event := range page.Data {
			raw, err := event.MarshalJSON()
			require.NoError(t, err)
			var envelope struct {
				EventType string `json:"event_type"`
				Payload   struct {
					CheckType string `json:"check_type"`
				} `json:"payload"`
			}
			require.NoError(t, json.Unmarshal(raw, &envelope))
			switch envelope.EventType {
			case "auth.check.failed":
				failed = append(failed, envelope.Payload.CheckType)
			case "auth.check.succeeded":
				succeeded = append(succeeded, envelope.Payload.CheckType)
			}
		}
		return step, failed, succeeded
	}

	t.Run("a sign-up's free email is no failed check", func(t *testing.T) {
		step, failed, succeeded := run(t, api.CreateFlowRequestPurposeRegister, api.FlowSubmitRequestFields{
			"email":                   jx.Raw(`"signup-events@example.com"`),
			"x-auth-methods#password": jx.Raw(`"super-secret-password-1"`),
		})
		require.Equal(t, "done", step)
		assert.Empty(t, failed)
		assert.ElementsMatch(t, []string{"User", "Password"}, succeeded, "the created user's checks")
	})

	t.Run("a sign-in's unknown email is a failed check", func(t *testing.T) {
		step, failed, succeeded := run(t, api.CreateFlowRequestPurposeLogin, api.FlowSubmitRequestFields{
			"email": jx.Raw(`"ghost-events@example.com"`),
		})
		require.Equal(t, "not_found", step)
		assert.Equal(t, []string{"User"}, failed)
		assert.Empty(t, succeeded)
	})
}
