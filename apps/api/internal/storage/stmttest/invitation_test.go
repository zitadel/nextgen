//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"crypto/rand"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/invitation"
)

// invitationNow is truncated to Postgres' microsecond precision so times
// round-trip equal on every dialect.
func invitationNow() time.Time {
	return time.Now().UTC().Truncate(time.Microsecond)
}

func newTestInvitation(projectID, relation string, expiresAt time.Time) *domain.Invitation {
	return &domain.Invitation{
		ProjectID:         projectID,
		Type:              domain.InvitationTypeProjectMember,
		ProjectMember:     &domain.InvitationProjectMember{Relation: relation},
		EncryptedMetadata: new("ciphertext"),
		ExpiresAt:         expiresAt,
		JourneyID:         rand.Text(),
		TokenHash:         domain.HashSecret(rand.Text()),
	}
}

func createInvitation(t *testing.T, stmts service.AllStatements, projectID string, expiresAt time.Time) *domain.Invitation {
	t.Helper()
	entity := newTestInvitation(projectID, "admin", expiresAt)
	require.NoError(t, stmts.CreateInvitation(t.Context(), entity))
	return entity
}

func invitationIDs(items []*domain.Invitation) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}

func TestInvitationStatements_Create(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("round_trips_every_column", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			expiresAt := invitationNow().Add(72 * time.Hour)
			entity := newTestInvitation(projectID, "editor", expiresAt)
			entity.CreatedBy = new("user_1")
			entity.CreatedByType = new(domain.EventActorTypeHuman)
			require.NoError(t, d.stmts.CreateInvitation(t.Context(), entity))

			// The id is minted by the dialect, not the caller (ADR 047).
			assert.True(t, domain.PrefixInvitation.Matches(entity.ID), "id %q is not inv_-prefixed", entity.ID)
			assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
			assert.Equal(t, domain.InvitationStatusPending, entity.Status)

			byID, err := d.stmts.GetInvitationByID(t.Context(), projectID, entity.ID)
			require.NoError(t, err)
			byHash, err := d.stmts.GetInvitationByTokenHash(t.Context(), entity.TokenHash)
			require.NoError(t, err)
			for _, got := range []*domain.Invitation{byID, byHash} {
				assert.Equal(t, entity.ProjectID, got.ProjectID)
				assert.Equal(t, entity.ID, got.ID)
				assert.Equal(t, domain.InvitationTypeProjectMember, got.Type)
				assert.Equal(t, &domain.InvitationProjectMember{Relation: "editor"}, got.ProjectMember)
				assert.Equal(t, "ciphertext", *got.EncryptedMetadata)
				assert.Equal(t, domain.InvitationStatusPending, got.Status)
				assert.Equal(t, "user_1", *got.CreatedBy)
				assert.Equal(t, domain.EventActorTypeHuman, *got.CreatedByType)
				assert.Equal(t, entity.CreatedAt, got.CreatedAt)
				assert.Equal(t, expiresAt, got.ExpiresAt)
				assert.Equal(t, entity.JourneyID, got.JourneyID)
				assert.Nil(t, got.AcceptedBy)
				assert.Nil(t, got.AcceptedAt)
				assert.Equal(t, entity.TokenHash, got.TokenHash)
			}
		})

		// A project secret names no user (ADR 086 §1).
		t.Run("without_creator", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			entity := newTestInvitation(projectID, "viewer", invitationNow().Add(time.Hour))
			entity.CreatedByType = new(domain.EventActorTypeService)
			require.NoError(t, d.stmts.CreateInvitation(t.Context(), entity))

			got, err := d.stmts.GetInvitationByID(t.Context(), projectID, entity.ID)
			require.NoError(t, err)
			assert.Nil(t, got.CreatedBy)
			assert.Equal(t, domain.EventActorTypeService, *got.CreatedByType)
		})

		// Lookup carries only the token, so its hash is unique across projects.
		t.Run("duplicate_token_hash_returns_UniqueError", func(t *testing.T) {
			first := createInvitation(t, d.stmts, ensureProject(t, d.stmts), invitationNow().Add(time.Hour))
			dup := newTestInvitation(ensureProject(t, d.stmts), "admin", invitationNow().Add(time.Hour))
			dup.TokenHash = first.TokenHash
			assert.ErrorIs(t, d.stmts.CreateInvitation(t.Context(), dup), new(database.UniqueError))
		})

		t.Run("unknown_project_returns_ForeignKeyError", func(t *testing.T) {
			entity := newTestInvitation("missing-project-"+uniqueSuffix(t), "admin", invitationNow().Add(time.Hour))
			assert.ErrorIs(t, d.stmts.CreateInvitation(t.Context(), entity), new(database.ForeignKeyError))
		})

		t.Run("missing_type_object_is_a_server_fault", func(t *testing.T) {
			entity := newTestInvitation(ensureProject(t, d.stmts), "admin", invitationNow().Add(time.Hour))
			entity.ProjectMember = nil
			assert.ErrorIs(t, d.stmts.CreateInvitation(t.Context(), entity), domain.ErrInternal(nil))
		})
	})
}

func TestInvitationStatements_GetUnknownIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		entity := createInvitation(t, d.stmts, projectID, invitationNow().Add(time.Hour))

		_, err := d.stmts.GetInvitationByID(t.Context(), projectID, "inv_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetInvitationByID(t.Context(), otherProject, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetInvitationByTokenHash(t.Context(), domain.HashSecret(rand.Text()))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestInvitationStatements_List(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		now := invitationNow()

		pending := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		expired := createInvitation(t, d.stmts, projectID, now.Add(-time.Hour))
		accepted := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		_, err := d.stmts.ChangeInvitationStatus(t.Context(), projectID, accepted.ID, domain.InvitationStatusAccepted, new("user_1"), now)
		require.NoError(t, err)
		rejected := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		_, err = d.stmts.ChangeInvitationStatus(t.Context(), projectID, rejected.ID, domain.InvitationStatusRejected, nil, now)
		require.NoError(t, err)
		createInvitation(t, d.stmts, otherProject, now.Add(time.Hour))

		list := func(status *domain.InvitationStatus, typ *domain.InvitationType) []string {
			t.Helper()
			result, err := d.stmts.ListInvitations(t.Context(), invitation.ListOptions(projectID, status, typ, now, 50))
			require.NoError(t, err)
			return invitationIDs(result.Items)
		}

		t.Run("newest_first", func(t *testing.T) {
			result, err := d.stmts.ListInvitations(t.Context(), invitation.ListOptions(projectID, nil, nil, now, 50))
			require.NoError(t, err)
			assert.ElementsMatch(t, []string{pending.ID, expired.ID, accepted.ID, rejected.ID}, invitationIDs(result.Items))
			for i := 1; i < len(result.Items); i++ {
				assert.False(t, result.Items[i].CreatedAt.After(result.Items[i-1].CreatedAt), "not newest first")
			}
		})

		t.Run("by_status", func(t *testing.T) {
			assert.Equal(t, []string{pending.ID}, list(new(domain.InvitationStatusPending), nil))
			assert.Equal(t, []string{expired.ID}, list(new(domain.InvitationStatusExpired), nil))
			assert.Equal(t, []string{accepted.ID}, list(new(domain.InvitationStatusAccepted), nil))
			assert.Equal(t, []string{rejected.ID}, list(new(domain.InvitationStatusRejected), nil))
		})

		t.Run("by_type", func(t *testing.T) {
			assert.Len(t, list(nil, new(domain.InvitationTypeProjectMember)), 4)
			assert.Empty(t, list(nil, new(domain.InvitationType("team_member"))))
		})
	})
}

func TestInvitationStatements_ChangeStatus(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("accept_records_the_accepter", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			now := invitationNow()
			entity := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))

			got, err := d.stmts.ChangeInvitationStatus(t.Context(), projectID, entity.ID, domain.InvitationStatusAccepted, new("user_2"), now)
			require.NoError(t, err)
			assert.Equal(t, domain.InvitationStatusAccepted, got.Status)
			assert.Equal(t, "user_2", *got.AcceptedBy)
			assert.Equal(t, now, *got.AcceptedAt)
			assert.Nil(t, got.EncryptedMetadata)

			read, err := d.stmts.GetInvitationByID(t.Context(), projectID, entity.ID)
			require.NoError(t, err)
			assert.Equal(t, got, read)
		})

		t.Run("reject", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			now := invitationNow()
			entity := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))

			got, err := d.stmts.ChangeInvitationStatus(t.Context(), projectID, entity.ID, domain.InvitationStatusRejected, nil, now)
			require.NoError(t, err)
			assert.Equal(t, domain.InvitationStatusRejected, got.Status)
			assert.Nil(t, got.AcceptedBy)
			assert.Nil(t, got.AcceptedAt)
			assert.Nil(t, got.EncryptedMetadata)
		})

		// All statuses but pending are final, so the second of two racing
		// changes finds nothing to change.
		t.Run("only_while_pending", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			now := invitationNow()
			entity := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
			_, err := d.stmts.ChangeInvitationStatus(t.Context(), projectID, entity.ID, domain.InvitationStatusRejected, nil, now)
			require.NoError(t, err)

			_, err = d.stmts.ChangeInvitationStatus(t.Context(), projectID, entity.ID, domain.InvitationStatusAccepted, new("user_2"), now)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("expired_is_not_pending", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			now := invitationNow()
			entity := createInvitation(t, d.stmts, projectID, now)

			_, err := d.stmts.ChangeInvitationStatus(t.Context(), projectID, entity.ID, domain.InvitationStatusAccepted, new("user_2"), now)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("unknown_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.ChangeInvitationStatus(t.Context(), projectID, "inv_does_not_exist", domain.InvitationStatusRejected, nil, invitationNow())
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("refuses_an_unwritable_change", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			now := invitationNow()
			entity := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
			for _, change := range []struct {
				status     domain.InvitationStatus
				acceptedBy *string
			}{
				{domain.InvitationStatusAccepted, nil},
				{domain.InvitationStatusRejected, new("user_2")},
				{domain.InvitationStatusPending, nil},
				{domain.InvitationStatusExpired, nil},
			} {
				_, err := d.stmts.ChangeInvitationStatus(t.Context(), projectID, entity.ID, change.status, change.acceptedBy, now)
				assert.ErrorIs(t, err, domain.ErrInternal(nil), "status %q", change.status)
			}
		})
	})
}

func TestInvitationStatements_ClearMetadata(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		now := invitationNow()

		// Replacing an expired invitation moves its metadata to the new one.
		expired := createInvitation(t, d.stmts, projectID, now.Add(-time.Hour))
		require.NoError(t, d.stmts.ClearInvitationMetadata(t.Context(), projectID, expired.ID, now))
		got, err := d.stmts.GetInvitationByID(t.Context(), projectID, expired.ID)
		require.NoError(t, err)
		assert.Nil(t, got.EncryptedMetadata)

		// A live invitation keeps the metadata its accepter's journey shows.
		pending := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		err = d.stmts.ClearInvitationMetadata(t.Context(), projectID, pending.ID, now)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		got, err = d.stmts.GetInvitationByID(t.Context(), projectID, pending.ID)
		require.NoError(t, err)
		assert.Equal(t, "ciphertext", *got.EncryptedMetadata)

		err = d.stmts.ClearInvitationMetadata(t.Context(), projectID, "inv_does_not_exist", now)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestInvitationStatements_DeletePending(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		now := invitationNow()

		pending := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		require.NoError(t, d.stmts.DeletePendingInvitation(t.Context(), projectID, pending.ID, now))
		_, err := d.stmts.GetInvitationByID(t.Context(), projectID, pending.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		// An expired or finished invitation keeps its row.
		expired := createInvitation(t, d.stmts, projectID, now.Add(-time.Hour))
		rejected := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		_, err = d.stmts.ChangeInvitationStatus(t.Context(), projectID, rejected.ID, domain.InvitationStatusRejected, nil, now)
		require.NoError(t, err)
		for _, id := range []string{expired.ID, rejected.ID, pending.ID} {
			err := d.stmts.DeletePendingInvitation(t.Context(), projectID, id, now)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		}
		for _, id := range []string{expired.ID, rejected.ID} {
			_, err := d.stmts.GetInvitationByID(t.Context(), projectID, id)
			assert.NoError(t, err)
		}
	})
}

func TestInvitationStatements_CountPending(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProject := ensureProject(t, d.stmts)
		now := invitationNow()

		count, err := d.stmts.CountPendingInvitations(t.Context(), projectID, now)
		require.NoError(t, err)
		assert.Zero(t, count)

		createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		createInvitation(t, d.stmts, projectID, now.Add(-time.Hour))
		rejected := createInvitation(t, d.stmts, projectID, now.Add(time.Hour))
		_, err = d.stmts.ChangeInvitationStatus(t.Context(), projectID, rejected.ID, domain.InvitationStatusRejected, nil, now)
		require.NoError(t, err)
		createInvitation(t, d.stmts, otherProject, now.Add(time.Hour))

		count, err = d.stmts.CountPendingInvitations(t.Context(), projectID, now)
		require.NoError(t, err)
		assert.EqualValues(t, 2, count)
	})
}

// The project FK cascades, so deleting a project takes its invitations with
// it (ADR 086 §10).
func TestInvitationStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		entity := createInvitation(t, d.stmts, projectID, invitationNow().Add(time.Hour))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetInvitationByTokenHash(t.Context(), entity.TokenHash)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
