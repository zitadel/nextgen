package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestSession_CreateAndGet(t *testing.T) {
	repo := new(repository.Session)

	tx, rollback := transactionForRollback(t)
	defer rollback()

	expiresAt := time.Now().Add(10 * time.Minute).UTC().Truncate(time.Second)
	session := &domain.Session{
		ProjectID: "proj-session-create",
		ID:        "sess-create",
		Factors: map[string]any{
			"user": map[string]any{
				"user_id":     "usr-1",
				"verified_at": "2026-04-28T16:00:00Z",
			},
		},
		AssuranceLevels: []string{"urn:nist:aal:1"},
		Metadata:        map[string]any{"source": "test"},
		UserAgent:       map[string]any{"fingerprint": "fp-1"},
		ExpiresAt:       &expiresAt,
	}

	require.NoError(t, repo.Create(t.Context(), tx, session))
	require.Equal(t, int64(1), session.Version)
	require.Equal(t, domain.SessionStateBuilding, session.State)
	require.False(t, session.CreatedAt.IsZero())

	stored, err := repo.Get(t.Context(), tx, session.ProjectID, session.ID)
	require.NoError(t, err)
	require.Equal(t, session.ProjectID, stored.ProjectID)
	require.Equal(t, session.ID, stored.ID)
	require.Equal(t, int64(1), stored.Version)
	require.Equal(t, domain.SessionStateBuilding, stored.State)
	require.Equal(t, session.AssuranceLevels, stored.AssuranceLevels)
	require.Equal(t, "test", stored.Metadata["source"])
	require.Equal(t, "fp-1", stored.UserAgent["fingerprint"])
	require.NotNil(t, stored.ExpiresAt)
	require.WithinDuration(t, expiresAt, *stored.ExpiresAt, time.Second)
}

func TestSession_List(t *testing.T) {
	repo := new(repository.Session)

	tx, rollback := transactionForRollback(t)
	defer rollback()

	userID := "usr-list"
	create := func(id string, state domain.SessionState, uid *string) {
		err := repo.Create(t.Context(), tx, &domain.Session{
			ProjectID:       "proj-session-list",
			ID:              id,
			State:           state,
			UserID:          uid,
			Factors:         map[string]any{},
			AssuranceLevels: []string{},
			Metadata:        map[string]any{},
		})
		require.NoError(t, err)
	}

	create("sess-list-1", domain.SessionStateBuilding, nil)
	create("sess-list-2", domain.SessionStateActive, &userID)
	create("sess-list-3", domain.SessionStateRevoked, &userID)
	err := repo.Create(t.Context(), tx, &domain.Session{
		ProjectID:       "proj-session-other",
		ID:              "sess-other-project",
		State:           domain.SessionStateActive,
		UserID:          &userID,
		Factors:         map[string]any{},
		AssuranceLevels: []string{},
		Metadata:        map[string]any{},
	})
	require.NoError(t, err)

	sessions, total, err := repo.List(t.Context(), tx, domain.SessionListFilter{
		ProjectID: "proj-session-list",
	})
	require.NoError(t, err)
	require.Equal(t, uint64(3), total)
	require.Len(t, sessions, 3)

	state := domain.SessionStateActive
	sessions, total, err = repo.List(t.Context(), tx, domain.SessionListFilter{
		ProjectID: "proj-session-list",
		State:     &state,
	})
	require.NoError(t, err)
	require.Equal(t, uint64(1), total)
	require.Len(t, sessions, 1)
	require.Equal(t, "sess-list-2", sessions[0].ID)

	sessions, total, err = repo.List(t.Context(), tx, domain.SessionListFilter{
		ProjectID: "proj-session-list",
		UserID:    &userID,
		Limit:     1,
	})
	require.NoError(t, err)
	require.Equal(t, uint64(2), total)
	require.Len(t, sessions, 1)
}

func TestSession_Revoke(t *testing.T) {
	repo := new(repository.Session)

	tx, rollback := transactionForRollback(t)
	defer rollback()

	session := &domain.Session{
		ProjectID: "proj-session-revoke",
		ID:        "sess-revoke",
	}
	require.NoError(t, repo.Create(t.Context(), tx, session))
	require.Equal(t, int64(1), session.Version)

	require.NoError(t, repo.Revoke(t.Context(), tx, session.ProjectID, session.ID))

	stored, err := repo.Get(t.Context(), tx, session.ProjectID, session.ID)
	require.NoError(t, err)
	require.Equal(t, domain.SessionStateRevoked, stored.State)
	require.Equal(t, int64(2), stored.Version)
}
