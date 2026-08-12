//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

// TestBranding exercises the branding revision API and its projection onto
// flow responses (ADR 040): publish → echoed on flow creation; publish again
// → the newer revision wins; invalid templates are rejected by the lexical
// gate; projects without branding fall back to the built-in default.
func TestBranding(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.CreateBrandingParams{ProjectID: api.ProjectID(project.ID)}

	const templateRev1 = `<zl-page-shell data-rev="1">{% mandatory_gates %}</zl-page-shell>`
	const templateRev2 = `<zl-page-shell data-rev="2">{% mandatory_gates %}</zl-page-shell>`

	createResp, err := client.CreateBranding(t.Context(), &api.Branding{
		Layout:         api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		LiquidTemplate: api.NewOptString(templateRev1),
	}, params)
	require.NoError(t, err)
	require.IsType(t, &api.BrandingRevisionResponse{}, createResp, "create branding: %s", helpers.MustMarshal(t, createResp))
	rev1 := createResp.(*api.BrandingRevisionResponse)
	assert.NotEmpty(t, rev1.ID)
	assert.Equal(t, api.BrandingLayoutSplit, rev1.Branding.Layout.Value)
	assert.Equal(t, templateRev1, rev1.Branding.LiquidTemplate.Value)

	t.Run("get by id round-trips the stored configuration", func(t *testing.T) {
		getResp, err := client.GetBrandingById(t.Context(), api.GetBrandingByIdParams{
			ID: rev1.ID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, getResp, "get branding: %s", helpers.MustMarshal(t, getResp))
		got := getResp.(*api.BrandingRevisionResponse)
		assert.Equal(t, rev1.ID, got.ID)
		assert.Equal(t, templateRev1, got.Branding.LiquidTemplate.Value)
	})

	t.Run("unknown revision id is a 404", func(t *testing.T) {
		getResp, err := client.GetBrandingById(t.Context(), api.GetBrandingByIdParams{
			ID: "brnd_does_not_exist",
		})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, getResp, "get branding: %s", helpers.MustMarshal(t, getResp))
		errResp := getResp.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode("brnd.not_found"), errResp.Code)
	})

	t.Run("lexical gate rejects a hostile template", func(t *testing.T) {
		resp, err := client.CreateBranding(t.Context(), &api.Branding{
			LiquidTemplate: api.NewOptString(`<img src=x onerror="alert(1)">`),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, resp, "create branding: %s", helpers.MustMarshal(t, resp))
		errResp := resp.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), errResp.Code)
	})

	t.Run("management API is bound to the token's project", func(t *testing.T) {
		// A second, real project: its secret must not manage the first
		// project's branding, and the answers must not reveal that the
		// foreign project exists (identical to the nonexistent-project
		// responses).
		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		foreign, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, foreign, other)

		createResp, err := foreign.CreateBranding(t.Context(), &api.Branding{
			LiquidTemplate: api.NewOptString(templateRev1),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, createResp, "cross-project create: %s", helpers.MustMarshal(t, createResp))
		createErr := createResp.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), createErr.Code)

		getResp, err := foreign.GetBrandingById(t.Context(), api.GetBrandingByIdParams{
			ID: "brnd_irrelevant",
		})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, getResp, "cross-project get: %s", helpers.MustMarshal(t, getResp))
		getErr := getResp.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode("brnd.not_found"), getErr.Code)

		listResp, err := foreign.ListBranding(t.Context(), api.ListBrandingParams{
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetailsStatusCode{}, listResp, "cross-project list: %s", helpers.MustMarshal(t, listResp))
		listErr := listResp.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, 404, listErr.StatusCode)
	})

	t.Run("preview secret cannot touch the management API", func(t *testing.T) {
		// The preview secret is a login-plane credential that ships to
		// visitors' browsers; templates reach the login inline on flow
		// responses, so the management API rejects it entirely — including
		// on its own project.
		preview, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetPreviewSecretOnApiClient(t, preview, project)

		createResp, err := preview.CreateBranding(t.Context(), &api.Branding{
			LiquidTemplate: api.NewOptString(templateRev1),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetailsStatusCode{}, createResp, "preview create: %s", helpers.MustMarshal(t, createResp))
		createErr := createResp.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, 403, createErr.StatusCode)
		assert.Equal(t, api.ErrorCode("brnd.permission_denied"), createErr.Response.Code)

		listResp, err := preview.ListBranding(t.Context(), api.ListBrandingParams{
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetailsStatusCode{}, listResp, "preview list: %s", helpers.MustMarshal(t, listResp))
		listErr := listResp.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, 403, listErr.StatusCode)
	})

	t.Run("unknown project is a 400, not a 500", func(t *testing.T) {
		resp, err := client.CreateBranding(t.Context(), &api.Branding{
			LiquidTemplate: api.NewOptString(templateRev1),
		}, api.CreateBrandingParams{ProjectID: api.ProjectID("proj_does_not_exist")})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, resp, "create branding: %s", helpers.MustMarshal(t, resp))
		errResp := resp.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), errResp.Code)
	})

	t.Run("font_url is read-only in v1", func(t *testing.T) {
		fontURL, err := url.Parse("https://fonts.example.com/css2?family=Arimo")
		require.NoError(t, err)
		resp, err := client.CreateBranding(t.Context(), &api.Branding{
			FontURL: api.NewOptURI(*fontURL),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, resp, "create branding: %s", helpers.MustMarshal(t, resp))
		errResp := resp.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), errResp.Code)
	})

	t.Run("flow responses carry the latest revision", func(t *testing.T) {
		schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
		defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(project.ID),
			FlowDefinition: passwordLoginFlowDefinition(schemaURL),
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

		flowResp := createBrandingTestFlow(t, client, project.ID)
		require.Equal(t, api.BrandingLayoutSplit, flowResp.Branding.Value.Layout.Value)
		require.Equal(t, templateRev1, flowResp.Branding.Value.LiquidTemplate.Value)

		// Publish a second revision: the next flow response resolves it
		// without any flow-side changes (live latest-revision resolution).
		rev2Resp, err := client.CreateBranding(t.Context(), &api.Branding{
			Layout:         api.NewOptBrandingLayout(api.BrandingLayoutCentered),
			LiquidTemplate: api.NewOptString(templateRev2),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, rev2Resp, "create branding rev2: %s", helpers.MustMarshal(t, rev2Resp))
		rev2 := rev2Resp.(*api.BrandingRevisionResponse)
		require.NotEqual(t, rev1.ID, rev2.ID)

		flowResp = createBrandingTestFlow(t, client, project.ID)
		assert.Equal(t, api.BrandingLayoutCentered, flowResp.Branding.Value.Layout.Value)
		assert.Equal(t, templateRev2, flowResp.Branding.Value.LiquidTemplate.Value)

		t.Run("list returns revisions newest first", func(t *testing.T) {
			listResp, err := client.ListBranding(t.Context(), api.ListBrandingParams{
				ProjectID: api.ProjectID(project.ID),
			})
			require.NoError(t, err)
			require.IsType(t, &api.ListBrandingResponse{}, listResp, "list branding: %s", helpers.MustMarshal(t, listResp))
			list := listResp.(*api.ListBrandingResponse)
			require.Len(t, *list, 2)
			assert.Equal(t, rev2.ID, (*list)[0].ID)
			assert.Equal(t, rev1.ID, (*list)[1].ID)
		})
	})

	t.Run("projects without branding fall back to the default", func(t *testing.T) {
		bare, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)

		bareClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, bareClient, bare)

		schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
		defResp, err := bareClient.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(bare.ID),
			FlowDefinition: passwordLoginFlowDefinition(schemaURL),
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

		flowResp := createBrandingTestFlow(t, bareClient, bare.ID)
		assert.Equal(t, api.BrandingLayoutCentered, flowResp.Branding.Value.Layout.Value)
		assert.False(t, flowResp.Branding.Value.LiquidTemplate.Set, "no template expected: %+v", flowResp.Branding)
	})
}

func createBrandingTestFlow(t *testing.T, client *helpers.ApiClient, projectID string) api.FlowResponse {
	t.Helper()
	resp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(projectID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, "create flow: %s", helpers.MustMarshal(t, resp))
	withHeaders := resp.(*api.FlowResponseHeaders)
	return withHeaders.Response
}
