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
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestListEventsByUser pins GET /events's user_id filter on real sign-ins:
// it returns what happened to one user's account, whoever acted. Before the
// exchange nobody has signed in, so the checks have no actor; they name the
// user all the same, a rejected password included. Another user's sign-in is
// not among them, and a session someone else revokes is.
func TestListEventsByUser(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: helpers.TeamName()})
	require.NoError(t, err)
	// A claimed project: its events are listed.
	harness.SeedOwningTeam(t, project.ID, team.ID)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	const (
		ada      = "user_evtada01"
		adaEmail = "evt-ada@example.com"
		bob      = "user_evtbob01"
		bobEmail = "evt-bob@example.com"
		password = "correct-horse-battery-staple"
	)
	users := harness.EnsureUserFixture(t)
	encodedHash, err := harness.EnsureHasher(t).Hash(t.Context(), password)
	require.NoError(t, err)
	for userID, email := range map[string]string{ada: adaEmail, bob: bobEmail} {
		emailAttr, err := domain.NewCreateAttribute("email", email, domain.AttributeUniquenessProject)
		require.NoError(t, err)
		require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
			ProjectID:               project.ID,
			SchemaURL:               schemaURL,
			ID:                      userID,
			InitialMembershipTeamID: &team.ID,
			Attributes:              domain.CreateAttributes{*emailAttr},
		}))
		require.NoError(t, users.SetPassword(t.Context(), &domain.SetUserPassword{ProjectID: project.ID, UserID: userID, EncodedHash: encodedHash}))
	}

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passwordLoginFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))
	deployPrimary(t, project.ID)

	// signIn runs the login flow for email, submitting each password in turn,
	// and exchanges the handoff for the session it returns. Every password
	// but the last is rejected.
	signIn := func(t *testing.T, email string, passwords ...string) (sessionID api.SessionID) {
		t.Helper()
		createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
			ProjectID: api.ProjectID(project.ID),
			Purpose:   api.CreateFlowRequestPurposeLogin,
		}, api.CreateFlowParams{})
		require.NoError(t, err)
		require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
		flow := createResp.(*api.FlowResponseHeaders)
		flowID := flow.Response.ID
		zflow := mustExtractZflow(t, flow.SetCookie)

		// submit answers with the step the flow is on now: the next one, or
		// the same one with its error when the server refused the value.
		submit := func(field, value string) api.FlowResponseHeaders {
			t.Helper()
			resp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
				Action: "submit",
				Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{field: jx.Raw(`"` + value + `"`)}),
			}, api.SubmitFlowStepParams{ID: flowID, Zflow: zflow})
			require.NoError(t, err)
			var answer api.FlowResponseHeaders
			switch r := resp.(type) {
			case *api.SubmitFlowStepOK:
				answer = api.FlowResponseHeaders(*r)
			case *api.SubmitFlowStepBadRequest:
				answer = api.FlowResponseHeaders(*r)
			default:
				require.Failf(t, "the step answered neither a step nor a refusal", "%s", helpers.MustMarshal(t, resp))
			}
			zflow = mustExtractZflow(t, answer.SetCookie)
			return answer
		}

		require.Equal(t, "password", submit("email", email).Response.Step.Name)
		for i, candidate := range passwords {
			step := submit("x-auth-methods#password", candidate)
			if i < len(passwords)-1 {
				require.Equal(t, "password", step.Response.Step.Name, "a rejected password stays on its step")
				require.True(t, step.Response.Step.Error.Set, "a rejected password is reported: %s", helpers.MustMarshal(t, step))
				continue
			}
			require.Equal(t, "done", step.Response.Step.Name, helpers.MustMarshal(t, step))
			handoff, ok := step.Response.HandoffToken.Get()
			require.True(t, ok, "expected a handoff token")
			exchanged, err := client.ExchangeHandoff(t.Context(), &api.ExchangeRequest{HandoffToken: handoff},
				api.ExchangeHandoffParams{ProjectID: api.ProjectID(project.ID)})
			require.NoError(t, err)
			require.IsType(t, &api.SessionWithTokenResponseHeaders{}, exchanged, "the exchange was refused")
			sessionID = exchanged.(*api.SessionWithTokenResponseHeaders).Response.Session.SessionID
		}
		return sessionID
	}
	signIn(t, adaEmail, "not-the-password", password)
	bobSession := signIn(t, bobEmail, password)

	// The types of the events a filter returns, with the user each names.
	type listed struct {
		EventType string  `json:"event_type"`
		UserID    *string `json:"user_id"`
		ActorID   *string `json:"actor_id"`
	}
	list := func(t *testing.T, params api.ListEventsParams) []listed {
		t.Helper()
		params.ProjectID = api.ProjectID(project.ID)
		params.Limit = api.NewOptLimit(5)
		var found []listed
		for pages := 0; ; pages++ {
			require.Less(t, pages, 10, "the list must end")
			resp, err := client.ListEvents(t.Context(), params)
			require.NoError(t, err)
			page, ok := resp.(*api.ListEventsResponse)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			for _, event := range page.Data {
				raw, err := event.MarshalJSON()
				require.NoError(t, err)
				var item listed
				require.NoError(t, json.Unmarshal(raw, &item))
				found = append(found, item)
			}
			token, ok := page.NextPageToken.Get()
			if !ok {
				return found
			}
			params.PageToken = api.NewOptPageToken(token)
		}
	}
	types := func(events []listed) []string {
		names := make([]string, len(events))
		for i, event := range events {
			names[i] = event.EventType
		}
		return names
	}

	t.Run("a user's sign-in, the rejected password included", func(t *testing.T) {
		events := list(t, api.ListEventsParams{UserID: api.NewOptString(ada)})
		// The order of two events of one transaction is the dialect's.
		assert.ElementsMatch(t, []string{
			"auth.check.succeeded", // the identifier resolved to the user
			"auth.check.failed",    // the rejected password
			"auth.check.succeeded", // the accepted one
			"auth.attempt.handed_off",
			"session.established",
			"auth.token.issued",
		}, types(events))
		for _, event := range events {
			require.NotNil(t, event.UserID, "%s names no user", event.EventType)
			assert.Equal(t, ada, *event.UserID, event.EventType)
		}
		// Whoever acted: nobody had signed in when the password was rejected.
		for _, event := range events {
			if event.EventType == "auth.check.failed" {
				assert.Nil(t, event.ActorID, "the rejected password has no actor")
			}
		}
	})

	t.Run("in one category", func(t *testing.T) {
		events := list(t, api.ListEventsParams{
			UserID:   api.NewOptString(ada),
			Category: []api.ListEventsCategoryItem{api.ListEventsCategoryItemSession},
		})
		assert.Equal(t, []string{"session.established"}, types(events))
	})

	t.Run("another user's sign-in is their own", func(t *testing.T) {
		events := list(t, api.ListEventsParams{UserID: api.NewOptString(bob)})
		assert.ElementsMatch(t, []string{
			"auth.check.succeeded",
			"auth.check.succeeded",
			"auth.attempt.handed_off",
			"session.established",
			"auth.token.issued",
		}, types(events))
		for _, event := range events {
			require.NotNil(t, event.UserID)
			assert.Equal(t, bob, *event.UserID, event.EventType)
		}
	})

	// Last, since it adds to what happened to the user: the project's key
	// revokes the session, and the user's account is still what it concerns.
	t.Run("what someone else did to the user's session", func(t *testing.T) {
		revoked, err := client.RevokeSession(t.Context(), api.RevokeSessionParams{SessionID: bobSession})
		require.NoError(t, err)
		require.IsType(t, &api.RevokeSessionNoContent{}, revoked, helpers.MustMarshal(t, revoked))

		events := list(t, api.ListEventsParams{UserID: api.NewOptString(bob)})
		assert.Subset(t, types(events), []string{"session.deleted", "auth.token.revoked"})
		for _, event := range events {
			require.NotNil(t, event.UserID, "%s names no user", event.EventType)
			assert.Equal(t, bob, *event.UserID, event.EventType)
		}
	})

	t.Run("a user nothing happened to", func(t *testing.T) {
		assert.Empty(t, list(t, api.ListEventsParams{UserID: api.NewOptString("user_nobody")}))
	})
}
