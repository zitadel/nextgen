//go:build postgres_integration

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
// flow responses (ADR 037): publish → echoed on flow creation; publish again
// → the newer revision wins; invalid templates are rejected by the lexical
// gate; projects without branding fall back to the built-in default.
func TestBranding(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	params := api.CreateBrandingParams{ProjectID: api.ProjectID(project.ID)}

	const templateRev1 = `<zl-page-shell data-rev="1">{% mandatory_gates %}</zl-page-shell>`
	const templateRev2 = `<zl-page-shell data-rev="2">{% mandatory_gates %}</zl-page-shell>`

	createResp, err := client.CreateBranding(t.Context(), &api.Branding{
		Layout:         api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		LiquidTemplate: api.NewOptString(templateRev1),
	}, params)
	require.NoError(t, err)
	rev1, ok := createResp.(*api.BrandingRevisionResponse)
	require.True(t, ok, "create branding: %+v", createResp)
	assert.NotEmpty(t, rev1.ID)
	assert.Equal(t, api.BrandingLayoutSplit, rev1.Branding.Layout.Value)
	assert.Equal(t, templateRev1, rev1.Branding.LiquidTemplate.Value)

	t.Run("get by id round-trips the stored configuration", func(t *testing.T) {
		getResp, err := client.GetBrandingById(t.Context(), api.GetBrandingByIdParams{
			ID:        rev1.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		got, ok := getResp.(*api.BrandingRevisionResponse)
		require.True(t, ok, "get branding: %+v", getResp)
		assert.Equal(t, rev1.ID, got.ID)
		assert.Equal(t, templateRev1, got.Branding.LiquidTemplate.Value)
	})

	t.Run("unknown revision id is a 404", func(t *testing.T) {
		getResp, err := client.GetBrandingById(t.Context(), api.GetBrandingByIdParams{
			ID:        "brnd_does_not_exist",
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		errResp, ok := getResp.(*api.ErrorDetails)
		require.True(t, ok, "get branding: %+v", getResp)
		assert.Equal(t, api.ErrorCode("brnd.not_found"), errResp.Code)
	})

	t.Run("lexical gate rejects a hostile template", func(t *testing.T) {
		resp, err := client.CreateBranding(t.Context(), &api.Branding{
			LiquidTemplate: api.NewOptString(`<img src=x onerror="alert(1)">`),
		}, params)
		require.NoError(t, err)
		errResp, ok := resp.(*api.ErrorDetails)
		require.True(t, ok, "create branding: %+v", resp)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), errResp.Code)
	})

	t.Run("unknown project is a 400, not a 500", func(t *testing.T) {
		resp, err := client.CreateBranding(t.Context(), &api.Branding{
			LiquidTemplate: api.NewOptString(templateRev1),
		}, api.CreateBrandingParams{ProjectID: api.ProjectID("proj_does_not_exist")})
		require.NoError(t, err)
		errResp, ok := resp.(*api.ErrorDetails)
		require.True(t, ok, "create branding: %+v", resp)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), errResp.Code)
	})

	t.Run("font_url is read-only in v1", func(t *testing.T) {
		fontURL, err := url.Parse("https://fonts.example.com/css2?family=Arimo")
		require.NoError(t, err)
		resp, err := client.CreateBranding(t.Context(), &api.Branding{
			FontURL: api.NewOptURI(*fontURL),
		}, params)
		require.NoError(t, err)
		errResp, ok := resp.(*api.ErrorDetails)
		require.True(t, ok, "create branding: %+v", resp)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), errResp.Code)
	})

	t.Run("flow responses carry the latest revision", func(t *testing.T) {
		schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
		defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(project.ID),
			FlowDefinition: passwordLoginFlowDefinition(schemaURL),
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %+v", defResp)

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
		rev2, ok := rev2Resp.(*api.BrandingRevisionResponse)
		require.True(t, ok, "create branding rev2: %+v", rev2Resp)
		require.NotEqual(t, rev1.ID, rev2.ID)

		flowResp = createBrandingTestFlow(t, client, project.ID)
		assert.Equal(t, api.BrandingLayoutCentered, flowResp.Branding.Value.Layout.Value)
		assert.Equal(t, templateRev2, flowResp.Branding.Value.LiquidTemplate.Value)

		t.Run("list returns revisions newest first", func(t *testing.T) {
			listResp, err := client.ListBranding(t.Context(), api.ListBrandingParams{
				ProjectID: api.ProjectID(project.ID),
			})
			require.NoError(t, err)
			list, ok := listResp.(*api.ListBrandingResponse)
			require.True(t, ok, "list branding: %+v", listResp)
			require.Len(t, *list, 2)
			assert.Equal(t, rev2.ID, (*list)[0].ID)
			assert.Equal(t, rev1.ID, (*list)[1].ID)
		})
	})

	t.Run("projects without branding fall back to the default", func(t *testing.T) {
		bare, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
		require.NoError(t, err)

		bareClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		bareClient.SetToken(bare.ProjectSecret)

		schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
		defResp, err := bareClient.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(bare.ID),
			FlowDefinition: passwordLoginFlowDefinition(schemaURL),
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %+v", defResp)

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
	withHeaders, ok := resp.(*api.FlowResponseHeaders)
	require.True(t, ok, "create flow: %+v", resp)
	return withHeaders.Response
}
