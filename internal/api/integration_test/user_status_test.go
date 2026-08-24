//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestTeamDelete_LocksOutDeactivatedUser is the #553 end-to-end: deleting a
// team deactivates its lifecycle-owned users, and deactivation must actually
// lock them out. Before the delete the user logs in and holds a session;
// after it the session is revoked, a fresh login resolves the user exactly
// like an unknown one, and the management API still serves the user with the
// honest deactivated status.
func TestTeamDelete_LocksOutDeactivatedUser(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	const (
		userID    = "user_deact-lockout-01"
		userEmail = "deact-lockout@example.com"
		userPass  = "correct-horse-battery-staple"
	)

	emailAttr, err := domain.NewCreateAttribute("email", userEmail, domain.AttributeUniquenessProject)
	require.NoError(t, err)
	users := harness.EnsureUserFixture(t)
	require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               schemaURL,
		ID:                      userID,
		LifecycleOwnerTeamID:    &team.ID,
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))
	encodedHash, err := harness.EnsureHasher(t).Hash(userPass)
	require.NoError(t, err)
	require.NoError(t, users.SetPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   project.ID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}))

	client, err := helpers.NewApiClient(testServer.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	projectSecret, err := harness.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
	require.NoError(t, err)

	// The not_found-routing definition makes unknown and deactivated
	// identifiers land on the same terminal, which is the point of Q12's
	// generic rejection: no account-status oracle.
	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passwordLoginFlowWithNotFoundFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

	// submitIdentifier starts a fresh flow and submits the email; it returns
	// the step the flow lands on plus the flow handle for follow-up steps.
	submitIdentifier := func(t *testing.T) (*api.SubmitFlowStepOK, api.SubmitFlowStepParams) {
		t.Helper()
		createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
			ProjectID: api.ProjectID(project.ID),
			Purpose:   api.CreateFlowRequestPurposeLogin,
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
		flowHeaders := createResp.(*api.FlowResponseHeaders)
		params := api.SubmitFlowStepParams{
			ID:    flowHeaders.Response.ID,
			Zflow: mustExtractZflow(t, flowHeaders.SetCookie.Value),
		}
		idResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
			Action: "submit",
			Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
				"email": jx.Raw(`"` + userEmail + `"`),
			}),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepOK{}, idResp, helpers.MustMarshal(t, idResp))
		idOK := idResp.(*api.SubmitFlowStepOK)
		params.Zflow = mustExtractZflow(t, idOK.SetCookie.Value)
		return idOK, params
	}

	getMySession := func(t *testing.T, cookie *http.Cookie) int {
		t.Helper()
		meReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, testServer.URL+"/sessions/me", nil)
		require.NoError(t, err)
		meReq.AddCookie(cookie)
		meResp, err := testServer.Client().Do(meReq)
		require.NoError(t, err)
		defer func() { _ = meResp.Body.Close() }()
		return meResp.StatusCode
	}

	// 1. The active user logs in: identifier resolves, password verifies,
	// and the handoff token exchanges into a session cookie.
	idOK, params := submitIdentifier(t)
	require.Equal(t, "password", idOK.Response.Step.Name, "an active user's identifier must resolve")
	pwResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"x-auth-methods#password": jx.Raw(`"` + userPass + `"`),
		}),
	}, params)
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, pwResp, helpers.MustMarshal(t, pwResp))
	pwOK := pwResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "done", pwOK.Response.Step.Name)
	handoffToken, hasToken := pwOK.Response.HandoffToken.Get()
	require.True(t, hasToken, "expected handoff token after successful password login")

	exchangeBody, err := json.Marshal(map[string]string{"handoff_token": handoffToken})
	require.NoError(t, err)
	exchangeReq, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		testServer.URL+"/sessions/exchange?project_id="+project.ID, bytes.NewReader(exchangeBody))
	require.NoError(t, err)
	exchangeReq.Header.Set("Content-Type", "application/json")
	exchangeReq.Header.Set("Authorization", "Bearer "+projectSecret)
	exchangeResp, err := testServer.Client().Do(exchangeReq)
	require.NoError(t, err)
	defer func() { _ = exchangeResp.Body.Close() }()
	if exchangeResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(exchangeResp.Body)
		t.Fatalf("exchange returned %d: %s", exchangeResp.StatusCode, body)
	}
	var sessionCookie *http.Cookie
	for _, cookie := range exchangeResp.Cookies() {
		if cookie.Name == "__nextgen_session" {
			sessionCookie = cookie
		}
	}
	require.NotNil(t, sessionCookie, "exchange must set the __nextgen_session cookie")
	require.Equal(t, http.StatusOK, getMySession(t, sessionCookie), "the session must work before the delete")

	// 2. Deleting the owning team deactivates the lifecycle-owned user.
	delResp, err := client.DeleteTeam(t.Context(), api.DeleteTeamParams{TeamID: api.TeamID(team.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteTeamNoContent{}, delResp, helpers.MustMarshal(t, delResp))

	// 3. The pre-delete session died inside the same transaction.
	assert.Equal(t, http.StatusUnauthorized, getMySession(t, sessionCookie),
		"a deactivated user's live session must be revoked")

	// 4. A fresh login resolves the deactivated user exactly like an unknown one.
	idOK, _ = submitIdentifier(t)
	assert.Equal(t, "not_found", idOK.Response.Step.Name,
		"a deactivated identifier must be indistinguishable from an unknown one")
	assert.True(t, idOK.Response.Step.Complete.Set, "expected terminal step")

	// 5. The management plane still serves the user, with the honest status.
	getResp, err := client.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
	require.NoError(t, err)
	require.IsType(t, &api.User{}, getResp, helpers.MustMarshal(t, getResp))
	assert.Equal(t, api.UserMetadataStatusDeactivated, getResp.(*api.User).Metadata.Status)

	listResp, err := client.ListUsers(t.Context(), api.ListUsersParams{})
	require.NoError(t, err)
	require.IsType(t, &api.ListUsersResponse{}, listResp, helpers.MustMarshal(t, listResp))
	listed := false
	for _, item := range listResp.(*api.ListUsersResponse).Users {
		if userID == userIDOf(t, item) {
			listed = true
		}
	}
	assert.True(t, listed, "a deactivated user must stay visible in the management list")
}

// userIDOf reads the envelope id of a listed user.
func userIDOf(t *testing.T, user api.User) string {
	t.Helper()
	return string(user.ID)
}
