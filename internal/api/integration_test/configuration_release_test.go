//go:build postgres_integration || spanner_integration

package integration_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

// bundleSchema is a user schema document as `.zitadel/schemas/<handle>.json`
// holds it: no `$id`, the objectType as its handle.
func bundleSchema(t *testing.T, objectType, title string) api.UserSchema {
	t.Helper()
	doc := fmt.Sprintf(`{
		"title": %q,
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"objectType": %q,
		"metaSchema": "%s/user-schema.json",
		"kind": "user-schema",
		"type": "object",
		"x-identifier": "email",
		"x-auth-methods": {
			"password": { "enabled": true }
		},
		"properties": {
			"email": { "type": "string", "format": "email", "x-unique": "project" }
		}
	}`, title, objectType, helpers.BuiltinSchemaBaseURL)
	schema := api.UserSchema{}
	require.NoError(t, schema.UnmarshalJSON([]byte(doc)))
	return schema
}

// TestConfigurationRelease covers the bundle constructor: a `.zitadel/`
// directory becomes a release with no client-side state, unchanged content
// resolves to the same revisions and the same release, and a change
// allocates only the revision that changed.
func TestConfigurationRelease(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	params := api.CreateConfigurationReleaseParams{ProjectID: api.ProjectID(project.ID)}

	const handle = "bundle-user"
	// What `.zitadel/flows/password-login.json` holds right now; the changed
	// subtest advances it, so later subtests post the content on disk.
	current := passwordLoginFlowDefinition(handle)
	bundle := func(flow api.FlowDefinition) *api.ConfigurationBundle {
		return &api.ConfigurationBundle{
			Schemas:         []api.UserSchema{bundleSchema(t, handle, "bundle user")},
			FlowDefinitions: []api.FlowDefinition{flow},
			Message:         api.NewOptString("initial release"),
		}
	}
	byHandle := func(revisions []api.ConfigurationReleaseResponseRevisionsItem) map[string]api.ConfigurationReleaseResponseRevisionsItem {
		out := make(map[string]api.ConfigurationReleaseResponseRevisionsItem, len(revisions))
		for _, revision := range revisions {
			out[string(revision.Kind)+"/"+revision.Handle] = revision
		}
		return out
	}

	first, err := client.CreateConfigurationRelease(t.Context(), bundle(current), params)
	require.NoError(t, err)
	require.IsType(t, &api.CreateConfigurationReleaseCreated{}, first, helpers.MustMarshal(t, first))
	created := api.ConfigurationReleaseResponse(*first.(*api.CreateConfigurationReleaseCreated))
	require.Len(t, created.Revisions, 2)
	firstRevisions := byHandle(created.Revisions)
	assert.True(t, firstRevisions["schema/"+handle].Created, "the schema was new to the project")
	assert.True(t, firstRevisions["flow_definition/password-login"].Created, "the flow was new to the project")
	assert.Len(t, created.Release.Pointers, 2)

	t.Run("the flow pins the schema the bundle produced", func(t *testing.T) {
		defResp, err := client.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{
			ID: firstRevisions["flow_definition/password-login"].RevisionID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))
		assert.Equal(t, firstRevisions["schema/"+handle].RevisionID, defResp.(*api.FlowDefinitionResponse).FlowDefinition.UserSchema)
	})

	t.Run("the identical bundle reuses every revision and the release", func(t *testing.T) {
		again, err := client.CreateConfigurationRelease(t.Context(), bundle(current), params)
		require.NoError(t, err)
		require.IsType(t, &api.CreateConfigurationReleaseOK{}, again, helpers.MustMarshal(t, again))
		reused := api.ConfigurationReleaseResponse(*again.(*api.CreateConfigurationReleaseOK))
		assert.Equal(t, created.Release.ID, reused.Release.ID)
		for _, revision := range reused.Revisions {
			assert.False(t, revision.Created, "%s/%s should have been reused", revision.Kind, revision.Handle)
			assert.Equal(t, firstRevisions[string(revision.Kind)+"/"+revision.Handle].RevisionID, revision.RevisionID)
		}
	})

	t.Run("a changed flow allocates only the flow revision", func(t *testing.T) {
		changed := passwordLoginFlowDefinition(handle)
		changed.Steps[0].Name = "username"
		changed.Purposes = api.FlowDefinitionPurposes{"login": "username"}
		current = changed
		resp, err := client.CreateConfigurationRelease(t.Context(), bundle(current), params)
		require.NoError(t, err)
		require.IsType(t, &api.CreateConfigurationReleaseCreated{}, resp, helpers.MustMarshal(t, resp))
		next := api.ConfigurationReleaseResponse(*resp.(*api.CreateConfigurationReleaseCreated))
		assert.NotEqual(t, created.Release.ID, next.Release.ID)
		revisions := byHandle(next.Revisions)
		assert.False(t, revisions["schema/"+handle].Created)
		assert.Equal(t, firstRevisions["schema/"+handle].RevisionID, revisions["schema/"+handle].RevisionID)
		assert.True(t, revisions["flow_definition/password-login"].Created)
		assert.NotEqual(t, firstRevisions["flow_definition/password-login"].RevisionID, revisions["flow_definition/password-login"].RevisionID)
	})

	t.Run("an empty bundle is refused", func(t *testing.T) {
		resp, err := client.CreateConfigurationRelease(t.Context(), &api.ConfigurationBundle{}, params)
		require.NoError(t, err)
		require.IsType(t, &api.CreateConfigurationReleaseErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, 400, resp.(*api.CreateConfigurationReleaseErrorResponseStatusCode).StatusCode)
	})

	t.Run("the preview-deploy credential may build a release", func(t *testing.T) {
		preview, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetPreviewDeployTokenOnApiClient(t, preview, project)
		resp, err := preview.CreateConfigurationRelease(t.Context(), bundle(current), params)
		require.NoError(t, err)
		require.IsType(t, &api.CreateConfigurationReleaseOK{}, resp, helpers.MustMarshal(t, resp))
	})
}
