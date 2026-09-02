package releases

import (
	"path"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
)

// The releases endpoints have no handler yet — this PR ships the contract
// only. These tests are what hold the spec to account in the meantime: every
// shipped example must decode into the generated type and pass the validation
// ogen derived from the spec, so a schema that cannot express its own examples
// fails here rather than in the first integration test.

func readExample(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := Examples.ReadFile(path.Join("examples", name))
	require.NoError(t, err)
	return raw
}

func TestCreateReleaseRequestExamples(t *testing.T) {
	for _, name := range []string{
		"create-release-request.json",
		"create-release-request-minimal.json",
	} {
		t.Run(name, func(t *testing.T) {
			var req api.CreateReleaseRequest
			require.NoError(t, req.UnmarshalJSON(readExample(t, name)))
			require.NoError(t, req.Validate())
			assert.NotEmpty(t, req.Pointers, "a release must pin at least one revision")
		})
	}
}

// TestCreateReleaseRequestAcceptsURLRevisionID pins the reason revision_id
// carries no prefix pattern: a schema's identity is its $id, which is a URL
// whenever the document supplied one. Constraining the field to ^sch_ would
// reject the shape every seeded project actually produces.
func TestCreateReleaseRequestAcceptsURLRevisionID(t *testing.T) {
	var req api.CreateReleaseRequest
	require.NoError(t, req.UnmarshalJSON(readExample(t, "create-release-request.json")))
	require.NoError(t, req.Validate())

	require.NotEmpty(t, req.Pointers)
	assert.Equal(t, api.CreateReleasePointerKindSchema, req.Pointers[0].Kind)
	assert.True(t, strings.HasPrefix(req.Pointers[0].RevisionID, "https://"),
		"the schema pointer example must exercise a URL revision id")
}

// TestCreateReleaseRequestCoversEveryKind keeps the worked example honest: a
// release spans the configurable resources of a project rather than a single
// kind, and every kind the enum accepts is exercised by a payload somewhere.
func TestCreateReleaseRequestCoversEveryKind(t *testing.T) {
	var req api.CreateReleaseRequest
	require.NoError(t, req.UnmarshalJSON(readExample(t, "create-release-request.json")))
	require.NoError(t, req.Validate())

	pinned := make(map[api.CreateReleasePointerKind]string, len(req.Pointers))
	for _, pointer := range req.Pointers {
		pinned[pointer.Kind] = pointer.RevisionID
	}

	for _, kind := range (api.CreateReleasePointerKind("")).AllValues() {
		assert.Contains(t, pinned, kind, "no example pins a %q revision", kind)
	}
}

func TestReleaseExamples(t *testing.T) {
	for _, name := range []string{
		"release.json",
		"release-machine-principal.json",
	} {
		t.Run(name, func(t *testing.T) {
			var rel api.Release
			require.NoError(t, rel.UnmarshalJSON(readExample(t, name)))
			require.NoError(t, rel.Validate())
			require.NotEmpty(t, rel.Pointers, "a release always reports the set it pins")

			// The caller never sends a handle, so the response is the only
			// place it comes from: the server reads it off each pinned
			// revision. A pointer without one would leave the pinned set
			// unreadable without resolving every revision.
			for _, pointer := range rel.Pointers {
				assert.NotEmpty(t, pointer.Handle, "every pinned revision reports its handle")
			}
		})
	}
}

// TestReleaseExamplesPinManyResourcesPerKind covers what the handle is for. A
// project has several user schemas and several flows, so a kind appearing more
// than once is the normal case, and the handle is the only thing telling two
// pointers of the same kind apart.
func TestReleaseExamplesPinManyResourcesPerKind(t *testing.T) {
	var rel api.Release
	require.NoError(t, rel.UnmarshalJSON(readExample(t, "release.json")))
	require.NoError(t, rel.Validate())

	handles := map[api.ReleasePointerKind][]string{}
	for _, pointer := range rel.Pointers {
		handles[pointer.Kind] = append(handles[pointer.Kind], pointer.Handle)
	}

	assert.ElementsMatch(t, []string{"human-user", "machine-user"},
		handles[api.ReleasePointerKindSchema])
	assert.ElementsMatch(t, []string{"default-login", "b2b-login"},
		handles[api.ReleasePointerKindFlow])
	assert.Equal(t, []string{"default"}, handles[api.ReleasePointerKindBranding],
		"a project has one branding, so it is the one kind that cannot repeat")
}

// TestBrandingHandleIsStableAcrossReleases separates the two things a pointer
// carries. Branding is revisioned like every other kind: the handle names the
// resource and never moves, while revision_id is what differs between one
// release and the next.
func TestBrandingHandleIsStableAcrossReleases(t *testing.T) {
	brandingOf := func(name string) api.ReleasePointer {
		t.Helper()
		var rel api.Release
		require.NoError(t, rel.UnmarshalJSON(readExample(t, name)))
		for _, pointer := range rel.Pointers {
			if pointer.Kind == api.ReleasePointerKindBranding {
				return pointer
			}
		}
		t.Fatalf("%s pins no branding revision", name)
		return api.ReleasePointer{}
	}

	first := brandingOf("release.json")
	second := brandingOf("release-machine-principal.json")

	assert.Equal(t, first.Handle, second.Handle, "the branding handle is constant")
	assert.NotEqual(t, first.RevisionID, second.RevisionID,
		"but the pinned branding revision moves between releases")
}

// TestReleaseMetadataCreatedByIsNullable covers the case the created_by shape
// exists for: a release assembled by a project secret carries no user
// identity, so the field is explicitly null rather than omitted.
func TestReleaseMetadataCreatedByIsNullable(t *testing.T) {
	var rel api.Release
	require.NoError(t, rel.UnmarshalJSON(readExample(t, "release-machine-principal.json")))
	require.NoError(t, rel.Validate())

	assert.True(t, rel.Metadata.CreatedBy.Null, "created_by is null for a machine principal")
	assert.True(t, rel.Metadata.CreatedByType.Null, "created_by_type is null alongside it")
	assert.True(t, rel.Metadata.GitDirty, "a dirty tree is recorded on the release")
}

func TestListReleasesResponseExamples(t *testing.T) {
	t.Run("with a next page", func(t *testing.T) {
		var resp api.ListReleasesResponse
		require.NoError(t, resp.UnmarshalJSON(readExample(t, "list-releases-response.json")))
		require.NoError(t, resp.Validate())

		require.Len(t, resp.Releases, 2)
		assert.True(t, resp.NextPageToken.Set)
		assert.False(t, resp.NextPageToken.Null)
	})

	t.Run("on the last page", func(t *testing.T) {
		var resp api.ListReleasesResponse
		require.NoError(t, resp.UnmarshalJSON(readExample(t, "list-releases-response-last-page.json")))
		require.NoError(t, resp.Validate())

		require.Len(t, resp.Releases, 1)
		assert.True(t, resp.NextPageToken.Null, "absence of a further page reads as null")
	})
}
