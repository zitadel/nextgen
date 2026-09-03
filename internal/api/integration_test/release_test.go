//go:build postgres_integration || spanner_integration

package integration_test

import (
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
	"github.com/zitadel/nextgen/internal/domain"
)

// releaseFixture is a project plus one pinnable revision of each kind. A
// seeded project already holds the default human-user schema and the default
// login flow definitions, so only branding has to be published.
type releaseFixture struct {
	project    string
	client     *helpers.ApiClient
	schemaURL  string
	flowdefID  string
	brandingID string
}

func newReleaseFixture(t *testing.T) releaseFixture {
	t.Helper()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	listResp, err := client.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionListResponse{}, listResp, helpers.MustMarshal(t, listResp))
	definitions := listResp.(*api.FlowDefinitionListResponse).FlowDefinitions
	require.NotEmpty(t, definitions, "a seeded project should hold at least one flow definition")

	return releaseFixture{
		project:    project.ID,
		client:     client,
		schemaURL:  apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
		flowdefID:  definitions[0].ID,
		brandingID: publishBranding(t, client, project.ID, `<zl-page-shell>{% mandatory_gates %}</zl-page-shell>`),
	}
}

func publishBranding(t *testing.T, client *helpers.ApiClient, projectID, template string) string {
	t.Helper()
	resp, err := client.CreateBranding(t.Context(), &api.Branding{
		Layout:         api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		LiquidTemplate: api.NewOptString(template),
	}, api.CreateBrandingParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	require.IsType(t, &api.BrandingRevisionResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.BrandingRevisionResponse).ID
}

func (f releaseFixture) pointers() []api.CreateReleasePointer {
	return []api.CreateReleasePointer{
		{Kind: api.ReleasePointerKindSchema, RevisionID: f.schemaURL},
		{Kind: api.ReleasePointerKindFlowDefinition, RevisionID: f.flowdefID},
		{Kind: api.ReleasePointerKindBranding, RevisionID: f.brandingID},
	}
}

func (f releaseFixture) create(t *testing.T, req *api.CreateReleaseRequest) api.CreateReleaseRes {
	t.Helper()
	resp, err := f.client.CreateRelease(t.Context(), req, api.CreateReleaseParams{
		ProjectID: api.ProjectID(f.project),
	})
	require.NoError(t, err)
	return resp
}

// TestCreateRelease covers assembling a release (#531): it pins revisions that
// already exist, records the handle each one declares, and is idempotent on
// the pinned set.
func TestCreateRelease(t *testing.T) {
	t.Parallel()

	fixture := newReleaseFixture(t)

	resp := fixture.create(t, &api.CreateReleaseRequest{
		Pointers: fixture.pointers(),
		Message:  api.NewOptString("initial import"),
		GitSha:   api.NewOptString("4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7"),
	})
	require.IsType(t, &api.CreateReleaseCreated{}, resp, "create release: %s", helpers.MustMarshal(t, resp))
	created := api.Release(*resp.(*api.CreateReleaseCreated))

	t.Run("the release records the handle each revision declares", func(t *testing.T) {
		assert.True(t, domain.PrefixRelease.Matches(string(created.ID)), "id %q is not rel_-prefixed", created.ID)
		assert.Equal(t, fixture.project, string(created.ProjectID))

		// Sorted by (kind, handle), so the order is the server's, not the
		// order the pointers were submitted in.
		assert.Equal(t, []api.ReleasePointer{
			{Kind: api.ReleasePointerKindBranding, Handle: "default", RevisionID: fixture.brandingID},
			{Kind: api.ReleasePointerKindFlowDefinition, Handle: created.Pointers[1].Handle, RevisionID: fixture.flowdefID},
			{Kind: api.ReleasePointerKindSchema, Handle: "human-user", RevisionID: fixture.schemaURL},
		}, created.Pointers)
		assert.NotEmpty(t, created.Pointers[1].Handle, "a flow definition's handle is its name")
	})

	t.Run("metadata carries what the caller supplied and who they were", func(t *testing.T) {
		assert.Equal(t, "initial import", created.Metadata.Message.Value)
		assert.Equal(t, "4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7", created.Metadata.GitSha.Value)
		assert.False(t, created.Metadata.GitDirty)
		assert.False(t, created.Metadata.CreatedAt.IsZero())

		// The caller is a project secret: it names no user, so created_by is
		// null, but created_by_type still says a machine assembled this.
		assert.True(t, created.Metadata.CreatedBy.Null, "a project secret names no user")
		assert.Equal(t, api.ReleaseMetadataCreatedByTypeService, created.Metadata.CreatedByType.Value)
	})

	// Metadata is excluded from the content hash, so a re-deploy of unchanged
	// content under a new message resolves to the release that already pins it
	// rather than creating a second one.
	t.Run("re-submitting the same set returns the existing release", func(t *testing.T) {
		resp := fixture.create(t, &api.CreateReleaseRequest{
			Pointers: fixture.pointers(),
			Message:  api.NewOptString("a different message entirely"),
		})
		require.IsType(t, &api.CreateReleaseOK{}, resp, "recreate release: %s", helpers.MustMarshal(t, resp))
		reused := api.Release(*resp.(*api.CreateReleaseOK))

		assert.Equal(t, created.ID, reused.ID)
		assert.Equal(t, "initial import", reused.Metadata.Message.Value,
			"the stored release keeps the message it was created with")
	})

	// Changing any pinned revision changes the set, so this is a new release
	// rather than a reuse of the one above.
	t.Run("changing a pinned revision assembles a new release", func(t *testing.T) {
		next := publishBranding(t, fixture.client, fixture.project,
			`<zl-page-shell data-rev="2">{% mandatory_gates %}</zl-page-shell>`)

		resp := fixture.create(t, &api.CreateReleaseRequest{
			Pointers: []api.CreateReleasePointer{
				{Kind: api.ReleasePointerKindSchema, RevisionID: fixture.schemaURL},
				{Kind: api.ReleasePointerKindFlowDefinition, RevisionID: fixture.flowdefID},
				{Kind: api.ReleasePointerKindBranding, RevisionID: next},
			},
		})
		require.IsType(t, &api.CreateReleaseCreated{}, resp, "create release: %s", helpers.MustMarshal(t, resp))
		assert.NotEqual(t, created.ID, api.Release(*resp.(*api.CreateReleaseCreated)).ID)
	})

	// The endpoint pins revisions, it does not create them, so a revision the
	// project does not hold is the caller's mistake about their own project.
	t.Run("pinning a revision that does not exist is rejected", func(t *testing.T) {
		resp := fixture.create(t, &api.CreateReleaseRequest{
			Pointers: []api.CreateReleasePointer{
				{Kind: api.ReleasePointerKindFlowDefinition, RevisionID: "flowdef_does_not_exist"},
			},
		})
		status, code, message, ok := errorResponseParts(t, resp)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrReleaseRevisionNotFound(nil).Code, code)
		assert.NotEmpty(t, message)
	})

	// A release describes one state of the project, so it cannot hold two
	// revisions of the same resource. Both pointers below name the branding of
	// this project, which has a single handle.
	t.Run("pinning one resource twice is rejected", func(t *testing.T) {
		second := publishBranding(t, fixture.client, fixture.project,
			`<zl-page-shell data-rev="3">{% mandatory_gates %}</zl-page-shell>`)

		resp := fixture.create(t, &api.CreateReleaseRequest{
			Pointers: []api.CreateReleasePointer{
				{Kind: api.ReleasePointerKindBranding, RevisionID: fixture.brandingID},
				{Kind: api.ReleasePointerKindBranding, RevisionID: second},
			},
		})
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrReleaseInvalid(nil, nil).Code, code)
	})

	// Sent raw rather than through the generated client, which enforces
	// minItems client-side and would never put the request on the wire. A
	// caller using curl or a hand-rolled SDK reaches the server, and the
	// server has to reject it too.
	t.Run("an empty pinned set is rejected by the contract", func(t *testing.T) {
		body := `{"pointers":[]}`
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			harness.EnsureTestServer(t).URL+"/releases?project_id="+url.QueryEscape(fixture.project),
			strings.NewReader(body),
		)
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+fixture.client.Token())

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		raw, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(raw))
		details := helpers.MustUnmarshal[api.ErrorDetails](t, raw)
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), details.Code)
	})
}

// Revisions are project-scoped, so a release can only pin what its own project
// holds: another project's revision id reads as one that does not exist, and
// is no existence oracle.
func TestCreateReleaseCannotPinAnotherProjectsRevision(t *testing.T) {
	t.Parallel()

	mine := newReleaseFixture(t)
	theirs := newReleaseFixture(t)

	resp := mine.create(t, &api.CreateReleaseRequest{
		Pointers: []api.CreateReleasePointer{
			{Kind: api.ReleasePointerKindBranding, RevisionID: theirs.brandingID},
		},
	})
	status, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, domain.ErrReleaseRevisionNotFound(nil).Code, code)
}

func TestCreateReleaseUnauthenticated(t *testing.T) {
	t.Parallel()

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	resp, err := client.CreateRelease(t.Context(), &api.CreateReleaseRequest{
		Pointers: []api.CreateReleasePointer{
			{Kind: api.ReleasePointerKindBranding, RevisionID: "brnd_1234"},
		},
	}, api.CreateReleaseParams{ProjectID: "proj_1234"})
	require.NoError(t, err)
	status, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusUnauthorized, status)
	assert.Equal(t, domain.ErrAuthUnauthorized(nil).Code, code)
}
