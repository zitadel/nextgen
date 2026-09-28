//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/release"
)

func ensureReleaseProject(t *testing.T, stmts service.AllStatements) string {
	t.Helper()
	projectID := "proj-rel-" + uniqueSuffix(t)
	require.NoError(t, stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })
	return projectID
}

// releasePointers returns a pinned set whose handles are stable but whose
// revision ids vary with revision, so callers can mint distinct releases.
func releasePointers(revision string) []domain.ReleasePointer {
	return []domain.ReleasePointer{
		{
			Kind:       domain.ReleasePointerKindSchema,
			Handle:     "human-user",
			RevisionID: "https://example.com/schemas/human-user.json?v=" + revision,
		},
		{
			Kind:       domain.ReleasePointerKindFlowDefinition,
			Handle:     "default-login",
			RevisionID: "flowdef_" + revision,
		},
		{
			Kind:       domain.ReleasePointerKindBranding,
			Handle:     "default",
			RevisionID: "brnd_" + revision,
		},
	}
}

func createRelease(t *testing.T, stmts service.AllStatements, projectID, revision string, metadata domain.ReleaseMetadata) *domain.Release {
	t.Helper()
	entity, err := domain.NewRelease(projectID, releasePointers(revision), metadata)
	require.NoError(t, err)
	require.NoError(t, stmts.CreateRelease(t.Context(), entity))
	scope, err := stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindRelease, projectID, entity.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ResourceKindRelease, scope.ResourceKind)
	assert.Equal(t, projectID, scope.ProjectID)
	assert.Nil(t, scope.TeamID)
	return entity
}

func TestReleaseStatements_CreateAndGetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)

		entity := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{
			Message:       new("initial import"),
			GitSHA:        new("4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7"),
			GitDirty:      true,
			CreatedBy:     new("user_1"),
			CreatedByType: new(domain.EventActorTypeHuman),
		})

		// The id is minted by the dialect, not the caller (ADR 047).
		assert.True(t, domain.PrefixRelease.Matches(entity.ID), "id %q is not rel_-prefixed", entity.ID)
		assert.False(t, entity.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)

		got, err := d.stmts.GetReleaseByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, entity.ContentHash, got.ContentHash)

		// The pinned set round-trips through three different JSON
		// representations — JSONB, Spanner JSON and a TEXT column — in the
		// canonical order it was hashed in.
		assert.Equal(t, entity.Pointers, got.Pointers)
		assert.Equal(t, entity.ContentHash, domain.ReleaseContentHash(got.Pointers),
			"the stored set must still hash to the stored hash")

		assert.Equal(t, "initial import", *got.Metadata.Message)
		assert.Equal(t, "4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7", *got.Metadata.GitSHA)
		assert.True(t, got.Metadata.GitDirty)
		assert.Equal(t, "user_1", *got.Metadata.CreatedBy)
		assert.Equal(t, domain.EventActorTypeHuman, *got.Metadata.CreatedByType)
	})
}

func TestReleaseStatements_GetByIDUnknownIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		_, err := d.stmts.GetReleaseByID(t.Context(), projectID, "rel_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A release assembled by a machine principal carries no user identity, and the
// caller may supply no message or commit. The metadata document is then empty,
// which has to survive the round trip on every dialect rather than coming back
// as a zero-valued struct that reads as "set to nothing".
func TestReleaseStatements_EmptyMetadataRoundTrips(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)

		entity := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		got, err := d.stmts.GetReleaseByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Nil(t, got.Metadata.Message)
		assert.Nil(t, got.Metadata.GitSHA)
		assert.Nil(t, got.Metadata.CreatedBy)
		assert.Nil(t, got.Metadata.CreatedByType)
		assert.False(t, got.Metadata.GitDirty)
	})
}

func TestReleaseStatements_GetByContentHash(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		entity := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		got, err := d.stmts.GetReleaseByContentHash(t.Context(), projectID, entity.ContentHash)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, got.ID)

		_, err = d.stmts.GetReleaseByContentHash(t.Context(), projectID, domain.ReleaseContentHash(releasePointers("0002")))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// The unique index on (project_id, content_hash) is what makes assembling a
// release idempotent under concurrency, rather than only in the
// read-then-insert happy path.
func TestReleaseStatements_ContentHashUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{Message: new("first")})

		// Same pinned set, different metadata: metadata is excluded from the
		// hash, so this collides.
		dup, err := domain.NewRelease(projectID, releasePointers("0001"), domain.ReleaseMetadata{Message: new("second")})
		require.NoError(t, err)
		err = d.stmts.CreateRelease(t.Context(), dup)
		assert.ErrorIs(t, err, new(database.IntegrityViolationError))
	})
}

// Two projects legitimately pin the same revisions, so the hash is unique per
// project rather than globally.
func TestReleaseStatements_ContentHashReusableAcrossProjects(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectA := ensureReleaseProject(t, d.stmts)
		projectB := ensureReleaseProject(t, d.stmts)

		relA := createRelease(t, d.stmts, projectA, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectB, "0001", domain.ReleaseMetadata{})

		assert.Equal(t, relA.ContentHash, relB.ContentHash)
		assert.NotEqual(t, relA.ID, relB.ID)

		// A read scoped to project A cannot reach project B's release even
		// though they hash identically.
		gotA, err := d.stmts.GetReleaseByContentHash(t.Context(), projectA, relA.ContentHash)
		require.NoError(t, err)
		assert.Equal(t, relA.ID, gotA.ID)

		_, err = d.stmts.GetReleaseByID(t.Context(), projectA, relB.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestReleaseStatements_ListIsProjectScopedNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		otherProject := ensureReleaseProject(t, d.stmts)

		var want []string
		for _, revision := range []string{"0001", "0002", "0003"} {
			want = append(want, createRelease(t, d.stmts, projectID, revision, domain.ReleaseMetadata{}).ID)
		}
		createRelease(t, d.stmts, otherProject, "0009", domain.ReleaseMetadata{})

		result, err := d.stmts.ListReleases(unfilteredListCtx(t), release.ListOptions(projectID, 50))
		require.NoError(t, err)

		got := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			assert.Equal(t, projectID, item.ProjectID)
			got = append(got, item.ID)
		}

		// Newest first, so the fixture order reversed.
		assert.Equal(t, []string{want[2], want[1], want[0]}, got)
	})
}

// The project FK cascades, so deleting a project takes its releases with it
// rather than leaving snapshots of a project that no longer exists.
func TestReleaseStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		result, err := d.stmts.ListReleases(unfilteredListCtx(t), release.ListOptions(projectID, 50))
		require.NoError(t, err)
		assert.Empty(t, result.Items)
	})
}
