package domain_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func pointers() []domain.ReleasePointer {
	return []domain.ReleasePointer{
		{
			Kind:       domain.ReleasePointerKindSchema,
			Handle:     "human-user",
			RevisionID: "https://example.com/schemas/default-human-user.json",
		},
		{
			Kind:       domain.ReleasePointerKindFlowDefinition,
			Handle:     "default-login",
			RevisionID: "flowdef_01KWHG09JXA7F0N9WD3P2E4YM5",
		},
		{
			Kind:       domain.ReleasePointerKindBranding,
			Handle:     "default",
			RevisionID: "brnd_01KWH1P4MYS7F0N9WD3P2E4YM5",
		},
	}
}

func TestNewRelease(t *testing.T) {
	t.Parallel()

	release, err := domain.NewRelease("proj_1", pointers(), domain.ReleaseMetadata{Message: new("initial import")})
	require.NoError(t, err)

	assert.Equal(t, "proj_1", release.ProjectID)
	assert.Empty(t, release.ID, "the dialect mints the id on insert")
	assert.Len(t, release.ContentHash, 64)

	// Sorted by (kind, handle), so the stored order is the hashed order and a
	// release read back compares equal to one built from the same set.
	assert.Equal(t, []domain.ReleasePointerKind{
		domain.ReleasePointerKindBranding,
		domain.ReleasePointerKindFlowDefinition,
		domain.ReleasePointerKindSchema,
	}, []domain.ReleasePointerKind{
		release.Pointers[0].Kind,
		release.Pointers[1].Kind,
		release.Pointers[2].Kind,
	})
}

func TestNewReleaseRejects(t *testing.T) {
	t.Parallel()

	duplicate := append(pointers(), domain.ReleasePointer{
		Kind:       domain.ReleasePointerKindSchema,
		Handle:     "human-user",
		RevisionID: "sch_a_later_revision",
	})

	blankHandle := pointers()
	blankHandle[0].Handle = "  "

	blankRevision := pointers()
	blankRevision[1].RevisionID = ""

	unknownKind := pointers()
	unknownKind[2].Kind = domain.ReleasePointerKind(42)

	for name, given := range map[string][]domain.ReleasePointer{
		"no pointers":             nil,
		"an empty pointer set":    {},
		"the same resource twice": duplicate,
		"a blank handle":          blankHandle,
		"a blank revision id":     blankRevision,
		"a kind outside the enum": unknownKind,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, err := domain.NewRelease("proj_1", given, domain.ReleaseMetadata{})
			require.Error(t, err)

			domErr, ok := errors.AsType[domain.Error](err)
			require.True(t, ok)
			assert.Equal(t, domain.ErrReleaseInvalid(nil, nil).Code, domErr.Code)
		})
	}
}

// TestReleaseContentHashIsGolden pins the canonical form. The hash is the
// idempotency key of every release ever written, so changing how it is derived
// silently re-creates releases that already exist — this literal is what makes
// such a change fail loudly instead.
func TestReleaseContentHashIsGolden(t *testing.T) {
	t.Parallel()

	assert.Equal(t,
		"ce1a80ee4eb86957a077b39cf79658ffe433fda522b1b6df7df8453c57522caa",
		domain.ReleaseContentHash(pointers()))
}

func TestReleaseContentHashIgnoresMetadata(t *testing.T) {
	t.Parallel()

	bare, err := domain.NewRelease("proj_1", pointers(), domain.ReleaseMetadata{})
	require.NoError(t, err)

	annotated, err := domain.NewRelease("proj_1", pointers(), domain.ReleaseMetadata{
		Message:  new("a different message entirely"),
		GitSHA:   new("4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7"),
		GitDirty: true,
	})
	require.NoError(t, err)

	assert.Equal(t, bare.ContentHash, annotated.ContentHash,
		"re-submitting the same revisions under a new message must resolve to the same release")
}

func TestReleaseContentHashIgnoresInputOrder(t *testing.T) {
	t.Parallel()

	shuffled := pointers()
	shuffled[0], shuffled[2] = shuffled[2], shuffled[0]

	assert.Equal(t, domain.ReleaseContentHash(pointers()), domain.ReleaseContentHash(shuffled))
}

// TestReleaseContentHashSeparatesFields guards the length-prefixed preimage. A
// naive concatenation would hash these two sets identically, since moving a
// character across the handle/revision boundary leaves the joined bytes equal.
func TestReleaseContentHashSeparatesFields(t *testing.T) {
	t.Parallel()

	left := []domain.ReleasePointer{
		{Kind: domain.ReleasePointerKindSchema, Handle: "ab", RevisionID: "cd"},
	}
	right := []domain.ReleasePointer{
		{Kind: domain.ReleasePointerKindSchema, Handle: "a", RevisionID: "bcd"},
	}

	assert.NotEqual(t, domain.ReleaseContentHash(left), domain.ReleaseContentHash(right))
}
