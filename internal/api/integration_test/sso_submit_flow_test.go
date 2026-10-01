//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/oidc/v3/pkg/oidc"
)

// TestFlowSSOSubmitRedirectsToProvider covers the sso submission: the
// redirect step carries the authorize URL built from the issued state
// record, the response binds the browser with the cookie, and the record
// pins the connection revision of the submission, the return target and
// the PKCE verifier the challenge was derived from.
func TestFlowSSOSubmitRedirectsToProvider(t *testing.T) {
	t.Parallel()
	f := newIdpFixture(t)
	// Static endpoints: the client is built without a discovery fetch.
	connection := helpers.OIDCConnection("google")
	oidcConn := connection.Oidc.Value
	oidcConn.AuthorizationEndpoint = api.NewOptString("https://accounts.example.test/authorize")
	oidcConn.TokenEndpoint = api.NewOptString("https://accounts.example.test/token")
	oidcConn.UserinfoEndpoint = api.NewOptString("https://accounts.example.test/userinfo")
	oidcConn.JwksURI = api.NewOptString("https://accounts.example.test/keys")
	// The document carries a reference; the engine fills it from the
	// project's variables when it builds the authorize URL.
	oidcConn.ClientID = "${{ GOOGLE_CLIENT_ID }}"
	connection.Oidc = api.NewOptIdpConnectionOidc(oidcConn)
	created := f.create(t, connection)
	varsResp, err := f.client.UpdateVariables(t.Context(), api.UpdateVariablesRequest{
		"GOOGLE_CLIENT_ID": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("google-client")),
	}, api.UpdateVariablesParams{ProjectID: f.projectID()})
	require.NoError(t, err)
	require.IsType(t, &api.Variables{}, varsResp, helpers.MustMarshal(t, varsResp))

	defResp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      f.projectID(),
		FlowDefinition: ssoLoginFlowDefinition(apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

	createResp, err := f.client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: f.projectID(),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	origin, err := url.Parse("https://login.example.test")
	require.NoError(t, err)
	returnTarget, err := url.Parse("https://login.example.test/login?flow=" + flowID)
	require.NoError(t, err)

	resp, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action:        "sso",
		SSOProviderID: api.NewOptString("google"),
		ReturnTarget:  api.NewOptURI(*returnTarget),
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: zflow, Origin: api.NewOptURI(*origin)})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, resp, helpers.MustMarshal(t, resp))
	ok := resp.(*api.SubmitFlowStepOK)

	step := ok.Response.Step
	require.Equal(t, "sso-redirect", step.Name)
	require.Equal(t, "sso.redirect.title", step.Texts.Value.TitleKey.Value)
	require.Empty(t, step.Fields)
	require.Empty(t, step.Actions)
	require.True(t, step.RedirectURL.IsSet(), "the redirect step carries the authorize url")
	redirect := step.RedirectURL.Value
	require.Equal(t, "https://accounts.example.test/authorize", redirect.Scheme+"://"+redirect.Host+redirect.Path)
	query := redirect.Query()
	require.Equal(t, "google-client", query.Get("client_id"))
	require.Equal(t, "https://login.example.test/__nextgen/idp/callback", query.Get("redirect_uri"))
	require.Equal(t, "code", query.Get("response_type"))
	require.Equal(t, "openid", query.Get("scope"))
	require.Equal(t, "S256", query.Get("code_challenge_method"))
	require.NotEmpty(t, query.Get("state"))
	require.NotEmpty(t, query.Get("nonce"))

	// The one cookie slot binds the browser; the flow cookie is not rotated
	// because the state did not change. Without a request host the handler
	// keeps Secure, so the cookie carries the __Host- prefix.
	cookies := (&http.Response{Header: http.Header{"Set-Cookie": []string{ok.SetCookie.Value}}}).Cookies()
	require.Len(t, cookies, 1, ok.SetCookie.Value)
	binding := cookies[0]
	require.Equal(t, "__Host-_zsso", binding.Name)
	require.True(t, binding.HttpOnly)
	require.True(t, binding.Secure)
	require.Equal(t, http.SameSiteLaxMode, binding.SameSite)
	require.Equal(t, "/", binding.Path)
	require.Equal(t, int(domain.AuthAttemptTTL.Seconds()), binding.MaxAge)

	// A revision created after the submission is not the pinned one.
	revised := helpers.OIDCConnection("google")
	revised.DisplayName = "Google Workspace"
	revisedResp := f.revise(t, revised)
	require.NotEqual(t, created.RevisionID, revisedResp.RevisionID)

	stmts := harness.EnsureServiceDB(t).Statements()
	record, err := stmts.ConsumeSSOState(t.Context(), f.project.ID, domain.HashSecret(query.Get("state")), binding.Value)
	require.NoError(t, err, "the state in the URL and the nonce in the cookie find the record")
	require.NotEmpty(t, record.AuthAttemptID)
	require.Equal(t, "google", record.Pending.ProviderSlug)
	require.Equal(t, created.RevisionID, record.Pending.ConnectionRevisionID)
	require.Equal(t, returnTarget.String(), record.Pending.ReturnTarget)
	require.Equal(t, query.Get("nonce"), record.Pending.OIDCNonce)

	crypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), f.project.ID, domain.EncryptionKeyPurposeSecret)
	require.NoError(t, err)
	verifier, err := record.Pending.DecryptPKCEVerifier(crypter)
	require.NoError(t, err)
	require.Equal(t, oidc.NewSHACodeChallenge(verifier), query.Get("code_challenge"), "the challenge is derived from the stored verifier")
}
