//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestEnvironments covers the environment read surface (#534): every project
// is seeded with the default runtime slots, the list returns them ordered by name,
// and one is addressable by name.
func TestEnvironments(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	listNames := func(t *testing.T, params api.ListEnvironmentsParams) []string {
		t.Helper()
		params.ProjectID = api.ProjectID(project.ID)
		res, err := client.ListEnvironments(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListEnvironmentsResponse{}, res, helpers.MustMarshal(t, res))
		listed := res.(*api.ListEnvironmentsResponse)
		names := make([]string, 0, len(listed.Environments))
		for _, env := range listed.Environments {
			names = append(names, string(env.Name))
		}
		return names
	}

	wantListed := slices.Sorted(slices.Values(domain.DefaultEnvironmentNames))

	t.Run("a new project is seeded with the default environments", func(t *testing.T) {
		assert.Equal(t, wantListed, listNames(t, api.ListEnvironmentsParams{}))
	})

	t.Run("get by name returns the environment", func(t *testing.T) {
		res, err := client.GetEnvironmentByName(t.Context(), api.GetEnvironmentByNameParams{
			ProjectID: api.ProjectID(project.ID),
			Name:      "prod",
		})
		require.NoError(t, err)
		require.IsType(t, &api.Environment{}, res, helpers.MustMarshal(t, res))
		env := res.(*api.Environment)
		assert.Equal(t, api.EnvironmentName("prod"), env.Name)
		assert.Equal(t, project.ID, string(env.ProjectID))
		assert.True(t, domain.PrefixEnvironment.Matches(env.ID), "id %q is not env_-prefixed", env.ID)
		assert.False(t, env.CreatedAt.IsZero())
	})

	t.Run("an unknown name is a 404", func(t *testing.T) {
		res, err := client.GetEnvironmentByName(t.Context(), api.GetEnvironmentByNameParams{
			ProjectID: api.ProjectID(project.ID),
			Name:      "nope",
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrEnvironmentNotFound().Code, code)
	})

	// The name pattern lives in the contract, so a name that could never have
	// been stored is rejected by the decoder before the handler runs. It is
	// still not an existence oracle: no project can hold such a name.
	t.Run("a malformed name is rejected by the contract", func(t *testing.T) {
		res, err := client.GetEnvironmentByName(t.Context(), api.GetEnvironmentByNameParams{
			ProjectID: api.ProjectID(project.ID),
			Name:      "Prod",
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrRequestInvalid().Code, code)
	})

	// The list is paginated even though the seeded set fits one page, so a
	// caller written against it keeps working once environments can be created.
	t.Run("the list pages", func(t *testing.T) {
		res, err := client.ListEnvironments(t.Context(), api.ListEnvironmentsParams{
			ProjectID: api.ProjectID(project.ID),
			Limit:     api.NewOptLimit(2),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListEnvironmentsResponse{}, res, helpers.MustMarshal(t, res))
		first := res.(*api.ListEnvironmentsResponse)
		require.Len(t, first.Environments, 2)
		require.True(t, first.NextPageToken.Set, "expected a next_page_token on a short first page")

		got := []string{string(first.Environments[0].Name), string(first.Environments[1].Name)}
		got = append(got, listNames(t, api.ListEnvironmentsParams{
			PageToken: api.NewOptPageToken(first.NextPageToken.Value),
		})...)
		assert.Equal(t, wantListed, got)
	})
}

// An environment of another project is unreachable rather than forbidden: the
// read is filtered by the caller's project, so a name that exists elsewhere
// answers exactly as an unused name does and is no existence oracle.
func TestEnvironmentsAreProjectScoped(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	// Both projects were seeded with a "prod", so this resolves the caller's.
	res, err := client.GetEnvironmentByName(t.Context(), api.GetEnvironmentByNameParams{
		ProjectID: api.ProjectID(project.ID),
		Name:      "prod",
	})
	require.NoError(t, err)
	require.IsType(t, &api.Environment{}, res, helpers.MustMarshal(t, res))
	mine := res.(*api.Environment)
	assert.Equal(t, project.ID, string(mine.ProjectID))

	otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherClient, other)
	otherRes, err := otherClient.GetEnvironmentByName(t.Context(), api.GetEnvironmentByNameParams{
		ProjectID: api.ProjectID(other.ID),
		Name:      "prod",
	})
	require.NoError(t, err)
	require.IsType(t, &api.Environment{}, otherRes, helpers.MustMarshal(t, otherRes))
	theirs := otherRes.(*api.Environment)

	// Same name, two projects, two distinct environments.
	assert.NotEqual(t, mine.ID, theirs.ID)
}
