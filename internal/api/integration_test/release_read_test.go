//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// createdRelease assembles one release and returns it, so the read tests do
// not each repeat the fixture wiring.
func createdRelease(t *testing.T, fixture releaseFixture, pointers []api.CreateReleasePointer, message string) api.Release {
	t.Helper()
	resp := fixture.create(t, &api.CreateReleaseRequest{
		Pointers: pointers,
		Message:  api.NewOptString(message),
	})
	require.IsType(t, &api.CreateReleaseCreated{}, resp, "create release: %s", helpers.MustMarshal(t, resp))
	return api.Release(*resp.(*api.CreateReleaseCreated))
}

// TestGetReleaseById reads back a release with the set it pins.
func TestGetReleaseById(t *testing.T) {
	t.Parallel()

	fixture := newReleaseFixture(t)
	created := createdRelease(t, fixture, fixture.pointers(), "initial import")

	t.Run("returns the release with its pinned set", func(t *testing.T) {
		resp, err := fixture.client.GetReleaseById(t.Context(), api.GetReleaseByIdParams{
			ProjectID: api.ProjectID(fixture.project),
			ReleaseID: created.ID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.Release{}, resp, "get release: %s", helpers.MustMarshal(t, resp))

		// The response of the create and the read are the same object, so a
		// caller that stored one can compare it against the other.
		assert.Equal(t, created, *resp.(*api.Release))
	})

	t.Run("an unknown release id is a 404", func(t *testing.T) {
		resp, err := fixture.client.GetReleaseById(t.Context(), api.GetReleaseByIdParams{
			ProjectID: api.ProjectID(fixture.project),
			ReleaseID: "rel_does_not_exist",
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrReleaseNotFound().Code, code)
	})
}

// A release of another project is unreachable rather than forbidden: the read
// is filtered by the caller's project, so it answers exactly as an unknown id
// does and is no existence oracle.
func TestGetReleaseByIdIsProjectScoped(t *testing.T) {
	t.Parallel()

	mine := newReleaseFixture(t)
	theirs := newReleaseFixture(t)

	release := createdRelease(t, mine, mine.pointers(), "mine")

	resp, err := theirs.client.GetReleaseById(t.Context(), api.GetReleaseByIdParams{
		ProjectID: api.ProjectID(theirs.project),
		ReleaseID: release.ID,
	})
	require.NoError(t, err)
	status, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, domain.ErrReleaseNotFound().Code, code)
}

// The list carries metadata only. Pointers are omitted rather than optional,
// so a list entry can never be mistaken for a release that pins nothing.
func TestListReleases(t *testing.T) {
	t.Parallel()

	fixture := newReleaseFixture(t)
	created := createdRelease(t, fixture, fixture.pointers(), "initial import")

	resp, err := fixture.client.ListReleases(t.Context(), api.ListReleasesParams{
		ProjectID: api.ProjectID(fixture.project),
	})
	require.NoError(t, err)
	require.IsType(t, &api.ListReleasesResponse{}, resp, "list releases: %s", helpers.MustMarshal(t, resp))
	listed := resp.(*api.ListReleasesResponse)

	require.Len(t, listed.Releases, 1)
	assert.Equal(t, created.ID, listed.Releases[0].ID)
	assert.Equal(t, api.ProjectID(fixture.project), listed.Releases[0].ProjectID)
	assert.Equal(t, "initial import", listed.Releases[0].Metadata.Message.Value)
	assert.Equal(t, created.Metadata.CreatedAt, listed.Releases[0].Metadata.CreatedAt)
}

// The list is paginated even though a project usually holds few releases, so a
// caller written against it keeps working as releases accumulate.
func TestListReleasesPagesNewestFirst(t *testing.T) {
	t.Parallel()

	fixture := newReleaseFixture(t)

	// Three distinct pinned sets, so three distinct releases: the branding
	// revision is what varies, since everything else the project holds is
	// seeded once.
	var want []api.ReleaseID
	for _, revision := range []string{"1", "2", "3"} {
		branding := publishBranding(t, fixture.client, fixture.project,
			`<zl-page-shell data-rev="`+revision+`">{% mandatory_gates %}</zl-page-shell>`)
		want = append(want, createdRelease(t, fixture, []api.CreateReleasePointer{
			{Kind: api.ReleasePointerKindSchema, RevisionID: fixture.schemaURL},
			{Kind: api.ReleasePointerKindBranding, RevisionID: branding},
		}, "revision "+revision).ID)
	}

	first, err := fixture.client.ListReleases(t.Context(), api.ListReleasesParams{
		ProjectID: api.ProjectID(fixture.project),
		Limit:     api.NewOptLimit(2),
	})
	require.NoError(t, err)
	require.IsType(t, &api.ListReleasesResponse{}, first, helpers.MustMarshal(t, first))
	page := first.(*api.ListReleasesResponse)
	require.Len(t, page.Releases, 2)
	require.True(t, page.NextPageToken.Set, "expected a next_page_token on a short first page")

	got := []api.ReleaseID{page.Releases[0].ID, page.Releases[1].ID}

	second, err := fixture.client.ListReleases(t.Context(), api.ListReleasesParams{
		ProjectID: api.ProjectID(fixture.project),
		PageToken: api.NewOptPageToken(page.NextPageToken.Value),
	})
	require.NoError(t, err)
	require.IsType(t, &api.ListReleasesResponse{}, second, helpers.MustMarshal(t, second))
	for _, item := range second.(*api.ListReleasesResponse).Releases {
		got = append(got, item.ID)
	}

	// Newest first, so the creation order reversed.
	assert.Equal(t, []api.ReleaseID{want[2], want[1], want[0]}, got)
}

// The list is scoped to the caller's project, so another project's releases
// are absent rather than filtered out of a shared result.
func TestListReleasesIsProjectScoped(t *testing.T) {
	t.Parallel()

	mine := newReleaseFixture(t)
	theirs := newReleaseFixture(t)

	release := createdRelease(t, mine, mine.pointers(), "mine")
	createdRelease(t, theirs, theirs.pointers(), "theirs")

	resp, err := mine.client.ListReleases(t.Context(), api.ListReleasesParams{
		ProjectID: api.ProjectID(mine.project),
	})
	require.NoError(t, err)
	require.IsType(t, &api.ListReleasesResponse{}, resp, helpers.MustMarshal(t, resp))
	listed := resp.(*api.ListReleasesResponse)

	require.Len(t, listed.Releases, 1)
	assert.Equal(t, release.ID, listed.Releases[0].ID)
}

func TestListReleasesUnauthenticated(t *testing.T) {
	t.Parallel()

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	resp, err := client.ListReleases(t.Context(), api.ListReleasesParams{ProjectID: "proj_1234"})
	require.NoError(t, err)
	status, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusUnauthorized, status)
	assert.Equal(t, domain.ErrAuthUnauthorized(nil).Code, code)
}
