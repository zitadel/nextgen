//go:build postgres_integration || spanner_integration

package integration_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestBuildRelease(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.BuildReleaseParams{ProjectID: api.ProjectID(project.ID)}
	template := `<zl-page-shell>{% mandatory_gates %}</zl-page-shell>`

	t.Run("builds a release from branding and reuses it on the same content", func(t *testing.T) {
		req := &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				Branding: api.NewOptBranding(api.Branding{
					Layout:         api.NewOptBrandingLayout(api.BrandingLayoutCentered),
					LiquidTemplate: api.NewOptString(template),
				}),
			},
			Message: api.NewOptString("branding only"),
		}
		resp, err := client.BuildRelease(t.Context(), req, params)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseCreated{}, resp, helpers.MustMarshal(t, resp))
		created := api.Release(*resp.(*api.BuildReleaseCreated))
		assert.True(t, domain.PrefixRelease.Matches(string(created.ID)))
		require.Len(t, created.Pointers, 1)
		assert.Equal(t, api.ReleasePointerKindBranding, created.Pointers[0].Kind)
		assert.Equal(t, "default", created.Pointers[0].Handle)

		again, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle:  req.Bundle,
			Message: api.NewOptString("different message"),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseOK{}, again, helpers.MustMarshal(t, again))
		reused := api.Release(*again.(*api.BuildReleaseOK))
		assert.Equal(t, created.ID, reused.ID)
		assert.Equal(t, "branding only", reused.Metadata.Message.Value)
	})

	t.Run("builds schemas and flows, auto-pinning the project schema", func(t *testing.T) {
		flow := newFlowDefinitionFixture("build-login", "human-user")
		resp, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				FlowDefinitions: []api.FlowDefinition{flow},
			},
			Message: api.NewOptString("flow with auto-pin"),
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseCreated{}, resp, helpers.MustMarshal(t, resp))
		created := api.Release(*resp.(*api.BuildReleaseCreated))

		kinds := map[api.ReleasePointerKind]string{}
		for _, pointer := range created.Pointers {
			kinds[pointer.Kind] = pointer.Handle
		}
		assert.Equal(t, "build-login", kinds[api.ReleasePointerKindFlowDefinition])
		assert.Equal(t, "human-user", kinds[api.ReleasePointerKindSchema])
		assert.Equal(t, apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
			created.Pointers[indexOfKind(created.Pointers, api.ReleasePointerKindSchema)].RevisionID)
	})

	t.Run("reports every failing resource at once", func(t *testing.T) {
		// Designation fails: x-identifier without x-unique:project.
		badSchema := fmt.Sprintf(`{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"kind": "user-schema",
			"metaSchema": "%s/user-schema.json",
			"objectType": "build-bad-schema",
			"x-auth-methods": {"password": {"enabled": true}},
			"x-identifier": "email",
			"properties": {"email": {"type": "string", "format": "email"}}
		}`, helpers.BuiltinSchemaBaseURL)
		var userSchema api.UserSchema
		require.NoError(t, userSchema.UnmarshalJSON([]byte(badSchema)))

		// Wire-valid; entry step for login is missing.
		badFlow := api.FlowDefinition{
			Name:       "build-bad-flow",
			Status:     "active",
			UserSchema: "human-user",
			Purposes:   map[string]string{"login": "missing-step"},
			Steps: []api.FlowDefinitionStep{{
				Name:     "done",
				Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
			}},
		}

		resp, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				Schemas: []api.ConfigurationBundleSchemasItem{{
					Type:       api.UserSchemaConfigurationBundleSchemasItem,
					UserSchema: userSchema,
				}},
				FlowDefinitions: []api.FlowDefinition{badFlow},
			},
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseBadRequest{}, resp, helpers.MustMarshal(t, resp))
		body := resp.(*api.BuildReleaseBadRequest)
		assert.Equal(t, api.ErrorCode(domain.ErrReleaseInvalid(nil, nil).Code), body.Code)
		require.True(t, body.Details.Set)
		require.Len(t, body.Details.Value.Resources, 2)
		codes := map[api.ReleasePointerKind]api.ErrorCode{}
		for _, resource := range body.Details.Value.Resources {
			codes[resource.Kind] = resource.Code
		}
		assert.Equal(t, api.ErrorCode(domain.ErrJSONSchemaInvalid().Code), codes[api.ReleasePointerKindSchema])
		assert.Equal(t, api.ErrorCode(domain.ErrFlowDefinitionInvalid("", nil).Code), codes[api.ReleasePointerKindFlowDefinition])
	})

	t.Run("refuses a flow whose user_schema is missing", func(t *testing.T) {
		resp, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				FlowDefinitions: []api.FlowDefinition{
					newFlowDefinitionFixture("missing-schema-flow", "does-not-exist"),
				},
			},
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseBadRequest{}, resp, helpers.MustMarshal(t, resp))
		body := resp.(*api.BuildReleaseBadRequest)
		assert.Equal(t, api.ErrorCode(domain.ErrReleaseInvalid(nil, nil).Code), body.Code)
		require.True(t, body.Details.Set)
		require.NotEmpty(t, body.Details.Value.Resources)
		assert.Equal(t, api.ReleasePointerKindFlowDefinition, body.Details.Value.Resources[0].Kind)
		assert.Equal(t, api.ErrorCode(domain.ErrReleaseUnresolvedReference().Code), body.Details.Value.Resources[0].Code)
	})

	t.Run("allocates a new branding revision only when content changes", func(t *testing.T) {
		own, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		ownClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, ownClient, own)
		ownParams := api.BuildReleaseParams{ProjectID: api.ProjectID(own.ID)}

		first, err := ownClient.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				Branding: api.NewOptBranding(api.Branding{
					Layout:         api.NewOptBrandingLayout(api.BrandingLayoutCentered),
					LiquidTemplate: api.NewOptString(template),
				}),
			},
			Message: api.NewOptString("branding v1"),
		}, ownParams)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseCreated{}, first, helpers.MustMarshal(t, first))
		v1 := api.Release(*first.(*api.BuildReleaseCreated))
		brndV1 := v1.Pointers[indexOfKind(v1.Pointers, api.ReleasePointerKindBranding)].RevisionID

		changed, err := ownClient.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				Branding: api.NewOptBranding(api.Branding{
					Layout:         api.NewOptBrandingLayout(api.BrandingLayoutSplit),
					LiquidTemplate: api.NewOptString(template),
				}),
			},
			Message: api.NewOptString("branding v2"),
		}, ownParams)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseCreated{}, changed, helpers.MustMarshal(t, changed))
		v2 := api.Release(*changed.(*api.BuildReleaseCreated))
		brndV2 := v2.Pointers[indexOfKind(v2.Pointers, api.ReleasePointerKindBranding)].RevisionID
		assert.NotEqual(t, v1.ID, v2.ID)
		assert.NotEqual(t, brndV1, brndV2)

		// A→B→A: rebuilding the original branding reuses the first release
		// and allocates no new branding revision.
		again, err := ownClient.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				Branding: api.NewOptBranding(api.Branding{
					Layout:         api.NewOptBrandingLayout(api.BrandingLayoutCentered),
					LiquidTemplate: api.NewOptString(template),
				}),
			},
			Message: api.NewOptString("branding v1 again"),
		}, ownParams)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseOK{}, again, helpers.MustMarshal(t, again))
		reused := api.Release(*again.(*api.BuildReleaseOK))
		assert.Equal(t, v1.ID, reused.ID)
		assert.Equal(t, brndV1, reused.Pointers[indexOfKind(reused.Pointers, api.ReleasePointerKindBranding)].RevisionID)
	})

	t.Run("allocates a new idp revision only when content changes", func(t *testing.T) {
		own, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		ownClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, ownClient, own)
		ownParams := api.BuildReleaseParams{ProjectID: api.ProjectID(own.ID)}

		original := helpers.OIDCConnection("google")
		edited := helpers.OIDCConnection("google")
		edited.DisplayName = "Google Workspace"
		build := func(t *testing.T, connection api.IdpConnection) api.BuildReleaseRes {
			t.Helper()
			resp, err := ownClient.BuildRelease(t.Context(), &api.BuildReleaseRequest{
				Bundle: api.ConfigurationBundle{Idps: []api.IdpConnection{connection}},
			}, ownParams)
			require.NoError(t, err)
			return resp
		}

		first := build(t, original)
		require.IsType(t, &api.BuildReleaseCreated{}, first, helpers.MustMarshal(t, first))
		v1 := api.Release(*first.(*api.BuildReleaseCreated))
		idpV1 := v1.Pointers[indexOfKind(v1.Pointers, api.ReleasePointerKindIdp)].RevisionID

		changed := build(t, edited)
		require.IsType(t, &api.BuildReleaseCreated{}, changed, helpers.MustMarshal(t, changed))
		v2 := api.Release(*changed.(*api.BuildReleaseCreated))
		assert.NotEqual(t, idpV1, v2.Pointers[indexOfKind(v2.Pointers, api.ReleasePointerKindIdp)].RevisionID)

		// A→B→A walks the connection's revision history to reuse the first one.
		again := build(t, original)
		require.IsType(t, &api.BuildReleaseOK{}, again, helpers.MustMarshal(t, again))
		reused := api.Release(*again.(*api.BuildReleaseOK))
		assert.Equal(t, v1.ID, reused.ID)
		assert.Equal(t, idpV1, reused.Pointers[indexOfKind(reused.Pointers, api.ReleasePointerKindIdp)].RevisionID)
	})

	t.Run("publishes a bundled policy, revising it only when its config changes", func(t *testing.T) {
		own, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		ownClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, ownClient, own)
		ownParams := api.BuildReleaseParams{ProjectID: api.ProjectID(own.ID)}

		build := func(t *testing.T, minLength int) api.BuildReleaseRes {
			t.Helper()
			resp, err := ownClient.BuildRelease(t.Context(), &api.BuildReleaseRequest{
				Bundle: api.ConfigurationBundle{Policies: []api.PublishPolicyRequest{
					passwordPolicyRequest(api.PasswordSetConfig{MinLength: api.NewOptInt(minLength)}),
				}},
			}, ownParams)
			require.NoError(t, err)
			return resp
		}
		applied := func(t *testing.T) int {
			t.Helper()
			resp, err := ownClient.ListPolicies(t.Context(), api.ListPoliciesParams{ProjectID: api.ProjectID(own.ID)})
			require.NoError(t, err)
			require.IsType(t, &api.ListPoliciesResponse{}, resp, helpers.MustMarshal(t, resp))
			items := resp.(*api.ListPoliciesResponse).Policies
			require.Len(t, items, 1)
			policy, ok := items[0].GetPasswordSetPolicy()
			require.True(t, ok)
			return policy.Config.MinLength.Value
		}

		first := build(t, 12)
		require.IsType(t, &api.BuildReleaseCreated{}, first, helpers.MustMarshal(t, first))
		v1 := api.Release(*first.(*api.BuildReleaseCreated))
		pointer := v1.Pointers[indexOfKind(v1.Pointers, api.ReleasePointerKindPolicy)]
		assert.Equal(t, api.ReleasePointerKindPolicy, pointer.Kind)
		assert.Equal(t, passwordSetOperation, pointer.Handle)
		assert.True(t, domain.PrefixPolicyRevision.Matches(pointer.RevisionID), pointer.RevisionID)
		assert.Equal(t, 12, applied(t))

		same := build(t, 12)
		require.IsType(t, &api.BuildReleaseOK{}, same, helpers.MustMarshal(t, same))
		assert.Equal(t, v1.ID, api.Release(*same.(*api.BuildReleaseOK)).ID)

		changed := build(t, 14)
		require.IsType(t, &api.BuildReleaseCreated{}, changed, helpers.MustMarshal(t, changed))
		v2 := api.Release(*changed.(*api.BuildReleaseCreated))
		assert.NotEqual(t, pointer.RevisionID, v2.Pointers[indexOfKind(v2.Pointers, api.ReleasePointerKindPolicy)].RevisionID)
		assert.Equal(t, 14, applied(t))

		// Back to 12: until a deployment's pinned revision is what applies,
		// the newest revision is, so going back appends one rather than
		// reusing the first, and 12 applies again.
		back := build(t, 12)
		require.IsType(t, &api.BuildReleaseCreated{}, back, helpers.MustMarshal(t, back))
		v3 := api.Release(*back.(*api.BuildReleaseCreated))
		assert.NotEqual(t, pointer.RevisionID, v3.Pointers[indexOfKind(v3.Pointers, api.ReleasePointerKindPolicy)].RevisionID)
		assert.Equal(t, 12, applied(t))
	})

	t.Run("refuses a policy its template refuses, and two for one operation", func(t *testing.T) {
		resp, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{Policies: []api.PublishPolicyRequest{
				passwordPolicyRequest(api.PasswordSetConfig{MinLength: api.NewOptInt(20), MaxLength: api.NewOptInt(10)}),
			}},
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseBadRequest{}, resp, helpers.MustMarshal(t, resp))
		resources := resp.(*api.BuildReleaseBadRequest).Details.Value.Resources
		require.Len(t, resources, 1)
		assert.Equal(t, api.ReleasePointerKindPolicy, resources[0].Kind)
		assert.Equal(t, api.ErrorCode(domain.ErrPolicyInvalid(nil, nil).Code), resources[0].Code)
		assert.Equal(t, passwordSetOperation, resources[0].Handle.Value)

		twice := passwordPolicyRequest(api.PasswordSetConfig{MinLength: api.NewOptInt(12)})
		resp, err = client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{Policies: []api.PublishPolicyRequest{twice, twice}},
		}, params)
		require.NoError(t, err)
		require.IsType(t, &api.BuildReleaseBadRequest{}, resp, helpers.MustMarshal(t, resp))
		resources = resp.(*api.BuildReleaseBadRequest).Details.Value.Resources
		require.Len(t, resources, 2)
		for _, resource := range resources {
			assert.Equal(t, api.ReleasePointerKindPolicy, resource.Kind)
			assert.Equal(t, api.ErrorCode(domain.ErrReleaseInvalid(nil, nil).Code), resource.Code)
		}
	})
}

// passwordPolicyRequest is a bundled password policy with config.
func passwordPolicyRequest(config api.PasswordSetConfig) api.PublishPolicyRequest {
	return api.NewPasswordSetPolicyInputPublishPolicyRequest(api.PasswordSetPolicyInput{
		Operation: api.PasswordSetPolicyInputOperationAuthFactorPasswordSet,
		Config:    config,
	})
}

func indexOfKind(pointers []api.ReleasePointer, kind api.ReleasePointerKind) int {
	for i, pointer := range pointers {
		if pointer.Kind == kind {
			return i
		}
	}
	return 0
}
