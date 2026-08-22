//go:build postgres_integration

package integration_test

import (
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const mgmtPasskeyUserSchemaURL = "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

// seedMgmtPasskeyUser creates a project, schema, team, and one user, returning
// the project, user id, and an API client authorized with the project secret.
func seedMgmtPasskeyUser(t *testing.T) (projectID, userID string, client *helpers.ApiClient) {
	t.Helper()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	suffix := time.Now().Format("150405000000")
	userID = "user_mgmtpk" + suffix
	emailAttr, err := domain.NewCreateAttribute("email", "mgmt-pk-"+suffix+"@example.com", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               mgmtPasskeyUserSchemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))

	client, err = helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	return project.ID, userID, client
}

func attestMgmtRegistration(t *testing.T, options api.BeginUserPasskeyRegistrationResponseOptions) api.FinishUserPasskeyRegistrationRequestAttestation {
	t.Helper()

	rp := helpers.PasskeyRelyingParty
	auth := virtualwebauthn.NewAuthenticator()
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	auth.AddCredential(cred)

	optionsJSON, err := json.Marshal(options)
	require.NoError(t, err)
	attestationOptions, err := virtualwebauthn.ParseAttestationOptions(string(optionsJSON))
	require.NoError(t, err)
	attestation := virtualwebauthn.CreateAttestationResponse(rp, auth, cred, *attestationOptions)

	var proof api.FinishUserPasskeyRegistrationRequestAttestation
	require.NoError(t, json.Unmarshal([]byte(attestation), &proof))
	return proof
}

func beginMgmtRegistration(t *testing.T, client *helpers.ApiClient, userID string) *api.BeginUserPasskeyRegistrationResponse {
	t.Helper()
	rp := helpers.PasskeyRelyingParty
	resp, err := client.BeginUserPasskeyRegistration(t.Context(), &api.BeginUserPasskeyRegistrationRequest{
		RpID:      rp.ID,
		RpOrigins: []url.URL{*mustParseURL(t, rp.Origin)},
		Username:  api.NewOptString("mgmt-enroll@example.com"),
	}, api.BeginUserPasskeyRegistrationParams{UserID: api.UserID(userID)})
	require.NoError(t, err)
	require.IsType(t, &api.BeginUserPasskeyRegistrationResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.BeginUserPasskeyRegistrationResponse)
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u
}

// TestUserPasskeyRegistrationManagement drives the management-plane enrollment
// ceremony end to end: begin returns creation options, finish verifies the
// attestation and persists the credential — no browser flow involved.
func TestUserPasskeyRegistrationManagement(t *testing.T) {
	t.Parallel()

	t.Run("begin_then_finish_registers_a_credential", func(t *testing.T) {
		t.Parallel()
		_, userID, client := seedMgmtPasskeyUser(t)

		begun := beginMgmtRegistration(t, client, userID)
		require.NotEmpty(t, begun.RegistrationID)
		require.NotEmpty(t, begun.Options)

		finishResp, err := client.FinishUserPasskeyRegistration(t.Context(), &api.FinishUserPasskeyRegistrationRequest{
			Attestation: attestMgmtRegistration(t, begun.Options),
			Name:        api.NewOptString("Work laptop"),
		}, api.FinishUserPasskeyRegistrationParams{
			UserID:         api.UserID(userID),
			RegistrationID: begun.RegistrationID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.FinishUserPasskeyRegistrationResponse{}, finishResp, helpers.MustMarshal(t, finishResp))
		finished := finishResp.(*api.FinishUserPasskeyRegistrationResponse)
		assert.NotEmpty(t, finished.ID)
		assert.Equal(t, "Work laptop", finished.Name)
		assert.False(t, finished.CreatedAt.IsZero())

		listResp, err := client.ListUserPasskeys(t.Context(), api.ListUserPasskeysParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserPasskeysResponse{}, listResp)
		listed := listResp.(*api.ListUserPasskeysResponse)
		require.Len(t, listed.Passkeys, 1)
		assert.Equal(t, finished.ID, listed.Passkeys[0].ID)
	})

	t.Run("begin_for_unknown_user_is_not_found", func(t *testing.T) {
		t.Parallel()
		_, _, client := seedMgmtPasskeyUser(t)

		rp := helpers.PasskeyRelyingParty
		resp, err := client.BeginUserPasskeyRegistration(t.Context(), &api.BeginUserPasskeyRegistrationRequest{
			RpID:      rp.ID,
			RpOrigins: []url.URL{*mustParseURL(t, rp.Origin)},
		}, api.BeginUserPasskeyRegistrationParams{UserID: api.UserID("user_does_not_exist")})
		require.NoError(t, err)
		require.IsType(t, &api.BeginUserPasskeyRegistrationNotFound{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("bad_attestation_leaves_the_ceremony_open_for_retry", func(t *testing.T) {
		t.Parallel()
		_, userID, client := seedMgmtPasskeyUser(t)

		begun := beginMgmtRegistration(t, client, userID)
		var garbage api.FinishUserPasskeyRegistrationRequestAttestation
		require.NoError(t, json.Unmarshal([]byte(`{"not":"valid-webauthn"}`), &garbage))

		rejectedResp, err := client.FinishUserPasskeyRegistration(t.Context(), &api.FinishUserPasskeyRegistrationRequest{
			Attestation: garbage,
		}, api.FinishUserPasskeyRegistrationParams{
			UserID:         api.UserID(userID),
			RegistrationID: begun.RegistrationID,
		})
		require.NoError(t, err)
		require.NotEqual(t, &api.FinishUserPasskeyRegistrationResponse{}, rejectedResp)
		assert.NotContains(t, helpers.MustMarshal(t, rejectedResp), `"id"`,
			"a rejected attestation must not register a credential")

		retryResp, err := client.FinishUserPasskeyRegistration(t.Context(), &api.FinishUserPasskeyRegistrationRequest{
			Attestation: attestMgmtRegistration(t, begun.Options),
		}, api.FinishUserPasskeyRegistrationParams{
			UserID:         api.UserID(userID),
			RegistrationID: begun.RegistrationID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.FinishUserPasskeyRegistrationResponse{}, retryResp, helpers.MustMarshal(t, retryResp))
	})

	t.Run("finish_for_a_different_user_is_rejected", func(t *testing.T) {
		t.Parallel()
		projectID, userID, client := seedMgmtPasskeyUser(t)

		// A second user in the same project.
		suffix := time.Now().Format("150405000000")
		otherID := "user_mgmtpkother" + suffix
		emailAttr, err := domain.NewCreateAttribute("email", "mgmt-pk-other-"+suffix+"@example.com", domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
			ProjectID:  projectID,
			SchemaURL:  mgmtPasskeyUserSchemaURL,
			ID:         otherID,
			Attributes: domain.CreateAttributes{*emailAttr},
		}))

		begun := beginMgmtRegistration(t, client, userID)
		resp, err := client.FinishUserPasskeyRegistration(t.Context(), &api.FinishUserPasskeyRegistrationRequest{
			Attestation: attestMgmtRegistration(t, begun.Options),
		}, api.FinishUserPasskeyRegistrationParams{
			UserID:         api.UserID(otherID),
			RegistrationID: begun.RegistrationID,
		})
		require.NoError(t, err)
		require.NotEqual(t, &api.FinishUserPasskeyRegistrationResponse{}, resp)
		assert.Contains(t, helpers.MustMarshal(t, resp), "att.invalid_request", helpers.MustMarshal(t, resp))
	})

	t.Run("consumed_ceremony_cannot_be_finished_again", func(t *testing.T) {
		t.Parallel()
		_, userID, client := seedMgmtPasskeyUser(t)

		begun := beginMgmtRegistration(t, client, userID)
		first, err := client.FinishUserPasskeyRegistration(t.Context(), &api.FinishUserPasskeyRegistrationRequest{
			Attestation: attestMgmtRegistration(t, begun.Options),
		}, api.FinishUserPasskeyRegistrationParams{
			UserID:         api.UserID(userID),
			RegistrationID: begun.RegistrationID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.FinishUserPasskeyRegistrationResponse{}, first, helpers.MustMarshal(t, first))

		second, err := client.FinishUserPasskeyRegistration(t.Context(), &api.FinishUserPasskeyRegistrationRequest{
			Attestation: attestMgmtRegistration(t, begun.Options),
		}, api.FinishUserPasskeyRegistrationParams{
			UserID:         api.UserID(userID),
			RegistrationID: begun.RegistrationID,
		})
		require.NoError(t, err)
		require.NotEqual(t, &api.FinishUserPasskeyRegistrationResponse{}, second)
		assert.Contains(t, helpers.MustMarshal(t, second), "att.not_found", helpers.MustMarshal(t, second))
	})
}
