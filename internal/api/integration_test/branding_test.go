//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
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

	t.Run("font_url without a font family is rejected", func(t *testing.T) {
		fontURL, err := url.Parse("https://fonts.example.com/css2?family=Arimo")
		require.NoError(t, err)
		resp, err := client.CreateBranding(t.Context(), &api.Branding{
			Typography: api.NewOptBrandingTypography(api.BrandingTypography{
				FontURL: api.NewOptURI(*fontURL),
			}),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, resp, "create branding: %s", helpers.MustMarshal(t, resp))
		errResp := resp.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode("brnd.invalid"), errResp.Code)
	})

	// Two gates sit in front of an appearance value, and a caller can tell them
	// apart by the code it gets back. The contract pattern runs at decode and
	// pins the shape, so anything that could leave its CSS declaration is
	// `req.invalid`. The allowlist runs in the domain and decides whether that
	// shape names a colour, so a well-formed value that is not one is
	// `brnd.invalid`.
	//
	// Both are checked against the raw wire rather than the generated client:
	// the client refuses to send the first group at all (which
	// TestBrandingColorPatternRejectsInjection covers), and an attacker sends
	// the bytes itself.
	postBranding := func(t *testing.T, body string) (int, string) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			harness.EnsureTestServer(t).URL+"/branding?project_id="+project.ID,
			strings.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+harness.ProjectSecret(t, project))

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer func() { _ = resp.Body.Close() }()
		raw, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		var got struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.Unmarshal(raw, &got), string(raw))
		return resp.StatusCode, got.Code
	}

	t.Run("values that could inject CSS fail the contract", func(t *testing.T) {
		for name, body := range map[string]string{
			"palette colour closes its declaration": `{"theme":{"light":{"palette":{"primary":"red; } :host { display: none"}}}}`,
			"palette colour fetches a url":          `{"theme":{"dark":{"palette":{"background":"url(https://evil.example/beacon.png)"}}}}`,
			"palette colour escapes a comment":      `{"theme":{"light":{"palette":{"primary":"red /* } */"}}}}`,
			"font family closes its declaration":    `{"typography":{"font_family":"Inter; } :host { display: none"}}`,
		} {
			t.Run(name, func(t *testing.T) {
				status, code := postBranding(t, body)
				assert.Equal(t, http.StatusBadRequest, status)
				assert.Equal(t, "req.invalid", code)
			})
		}
	})

	t.Run("well-formed values that name no colour fail the save gate", func(t *testing.T) {
		for name, body := range map[string]string{
			// Shaped like a colour function; `var` is not one of them.
			"var indirection": `{"theme":{"light":{"palette":{"primary":"var(--zl-primary)"}}}}`,
			// Likewise `local`, which the pattern admits and the allowlist does not.
			"unknown function": `{"theme":{"dark":{"palette":{"primary":"local(red)"}}}}`,
		} {
			t.Run(name, func(t *testing.T) {
				status, code := postBranding(t, body)
				assert.Equal(t, http.StatusBadRequest, status)
				assert.Equal(t, "brnd.invalid", code)
			})
		}
	})

	t.Run("appearance survives a publish and read back", func(t *testing.T) {
		// Its own project: this publishes a revision carrying no layout, which
		// would otherwise become the latest revision the flow-response case
		// below asserts against.
		ownProject, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		ownClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, ownClient, ownProject)
		ownParams := api.CreateBrandingParams{ProjectID: api.ProjectID(ownProject.ID)}

		fontURL, err := url.Parse("https://fonts.example.com/css2?family=Inter")
		require.NoError(t, err)
		lightLogo, err := url.Parse("https://cdn.example.com/on-light.svg")
		require.NoError(t, err)
		darkLogo, err := url.Parse("https://cdn.example.com/on-dark.svg")
		require.NoError(t, err)

		published := &api.Branding{
			Theme: api.NewOptBrandingTheme(api.BrandingTheme{
				Mode: api.NewOptBrandingThemeMode(api.BrandingThemeModeAuto),
				Light: api.NewOptBrandingThemeSide(api.BrandingThemeSide{
					LogoURL: api.NewOptURI(*lightLogo),
					Palette: api.NewOptBrandingPalette(api.BrandingPalette{
						Primary: api.NewOptBrandingColor("#4F46E5"),
					}),
				}),
				Dark: api.NewOptBrandingThemeSide(api.BrandingThemeSide{
					LogoURL: api.NewOptURI(*darkLogo),
					Palette: api.NewOptBrandingPalette(api.BrandingPalette{
						Primary: api.NewOptBrandingColor("#A5B4FC"),
					}),
				}),
			}),
			Typography: api.NewOptBrandingTypography(api.BrandingTypography{
				FontFamily: api.NewOptString("Inter, ui-sans-serif, sans-serif"),
				FontURL:    api.NewOptURI(*fontURL),
				Scale:      api.NewOptFloat64(1.1),
			}),
			Shape: api.NewOptBrandingShape(api.BrandingShape{
				Radius:    api.NewOptBrandingShapeRadius(api.NewIntBrandingShapeRadius(10)),
				Density:   api.NewOptBrandingShapeDensity(api.BrandingShapeDensityRegular),
				LogoScale: api.NewOptFloat64(1.5),
			}),
		}

		resp, err := ownClient.CreateBranding(t.Context(), published, ownParams)
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, resp, "create branding: %s", helpers.MustMarshal(t, resp))
		created := resp.(*api.BrandingRevisionResponse)

		getResp, err := ownClient.GetBrandingById(t.Context(), api.GetBrandingByIdParams{ID: created.ID})
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, getResp, "get branding: %s", helpers.MustMarshal(t, getResp))
		got := getResp.(*api.BrandingRevisionResponse).Branding

		assert.Equal(t, api.BrandingColor("#4F46E5"), got.Theme.Value.Light.Value.Palette.Value.Primary.Value)
		assert.Equal(t, api.BrandingColor("#A5B4FC"), got.Theme.Value.Dark.Value.Palette.Value.Primary.Value)
		assert.Equal(t, darkLogo.String(), got.Theme.Value.Dark.Value.LogoURL.Value.String())
		assert.Equal(t, "Inter, ui-sans-serif, sans-serif", got.Typography.Value.FontFamily.Value)
		assert.Equal(t, 1.1, got.Typography.Value.Scale.Value)
		radius, ok := got.Shape.Value.Radius.Value.GetInt()
		assert.True(t, ok, "radius should read back as pixels")
		assert.Equal(t, 10, radius)
		assert.Equal(t, fontURL.String(), got.Typography.Value.FontURL.Value.String())
	})

	t.Run("flow responses carry the latest revision", func(t *testing.T) {
		schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
		defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(project.ID),
			FlowDefinition: passwordLoginFlowDefinition(schemaURL),
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

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
		require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

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
