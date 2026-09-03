package release_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/release"
)

func TestRoundTrip(t *testing.T) {
	t.Parallel()

	pointers := []domain.ReleasePointer{
		{Kind: domain.ReleasePointerKindBranding, Handle: "default", RevisionID: "brnd_1"},
		{Kind: domain.ReleasePointerKindFlowDefinition, Handle: "default-login", RevisionID: "flowdef_1"},
		{Kind: domain.ReleasePointerKindSchema, Handle: "human-user", RevisionID: "https://example.com/s.json"},
	}
	metadata := domain.ReleaseMetadata{
		Message:       new("initial import"),
		GitDirty:      true,
		CreatedBy:     new("user_1"),
		CreatedByType: new(domain.EventActorTypeHuman),
	}

	rawPointers, err := release.MarshalPointers(pointers)
	require.NoError(t, err)
	rawMetadata, err := release.MarshalMetadata(metadata)
	require.NoError(t, err)

	got, err := release.ToDomain(release.Row{
		ProjectID:   "proj_1",
		ID:          "rel_1",
		ContentHash: domain.ReleaseContentHash(pointers),
		Pointers:    rawPointers,
		Metadata:    rawMetadata,
		CreatedAt:   time.Date(2026, 7, 14, 9, 11, 0, 0, time.UTC),
	})
	require.NoError(t, err)

	// Order survives, which is what lets the stored set re-hash to the stored
	// hash without re-sorting on read.
	assert.Equal(t, pointers, got.Pointers)
	assert.Equal(t, domain.ReleaseContentHash(pointers), got.ContentHash)

	assert.Equal(t, "initial import", *got.Metadata.Message)
	assert.Nil(t, got.Metadata.GitSHA)
	assert.True(t, got.Metadata.GitDirty)
	assert.Equal(t, "user_1", *got.Metadata.CreatedBy)
	assert.Equal(t, domain.EventActorTypeHuman, *got.Metadata.CreatedByType)
}

// A release assembled by a machine principal carries no user identity and may
// carry no message or commit either. Absent fields are omitted rather than
// written as null, so the document stays an empty object.
func TestMarshalMetadataOmitsAbsentFields(t *testing.T) {
	t.Parallel()

	raw, err := release.MarshalMetadata(domain.ReleaseMetadata{})
	require.NoError(t, err)
	assert.JSONEq(t, `{}`, string(raw))

	got, err := release.ToDomain(release.Row{Pointers: []byte(`[]`), Metadata: raw})
	require.NoError(t, err)
	assert.Nil(t, got.Metadata.Message)
	assert.Nil(t, got.Metadata.GitSHA)
	assert.Nil(t, got.Metadata.CreatedBy)
	assert.Nil(t, got.Metadata.CreatedByType)
	assert.False(t, got.Metadata.GitDirty)
}

// A kind is stored as its wire string, so a row written by a newer server that
// knows a kind this one does not must fail loudly rather than decode to the
// zero value and silently pin the wrong sort of resource.
func TestToDomainRejectsUnknownKind(t *testing.T) {
	t.Parallel()

	_, err := release.ToDomain(release.Row{
		ID:       "rel_1",
		Pointers: []byte(`[{"kind":"idp","handle":"google","revision_id":"idp_1"}]`),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "idp")
}

// The metadata document is open-ended by design: a field added by a newer
// server must not stop an older one reading the release.
func TestToDomainIgnoresUnknownMetadataFields(t *testing.T) {
	t.Parallel()

	got, err := release.ToDomain(release.Row{
		Pointers: []byte(`[]`),
		Metadata: []byte(`{"message":"from the future","ci_run_url":"https://ci.example.com/42"}`),
	})
	require.NoError(t, err)
	assert.Equal(t, "from the future", *got.Metadata.Message)
}

func TestToDomainNormalizesCreatedAtToUTC(t *testing.T) {
	t.Parallel()

	berlin, err := time.LoadLocation("Europe/Berlin")
	require.NoError(t, err)

	got, err := release.ToDomain(release.Row{
		Pointers:  []byte(`[]`),
		Metadata:  []byte(`{}`),
		CreatedAt: time.Date(2026, 7, 14, 11, 11, 0, 0, berlin),
	})
	require.NoError(t, err)
	assert.Equal(t, time.UTC, got.CreatedAt.Location())
}
