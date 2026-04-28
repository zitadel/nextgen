package repository_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

// newTestAttempt inserts an auth attempt with one password check into the given executor.
// It returns the attempt and the pre-created check so callers can reference the same objects.
func newTestAttempt(t *testing.T, repo *repository.AuthAttempt, client database.QueryExecutor, projectID, attemptID string) (*domain.AuthAttempt, *domain.PasswordAuthCheck) {
	t.Helper()
	check := &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}}
	attempt := &domain.AuthAttempt{
		ProjectID:      projectID,
		ID:             attemptID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthChecker{check},
	}
	require.NoError(t, repo.Create(t.Context(), client, attempt))
	return attempt, check
}

func TestAuthAttempt_Create(t *testing.T) {
	repo := new(repository.AuthAttempt)

	tests := []struct {
		name          string
		attempt       *domain.AuthAttempt
		assertAttempt func(t *testing.T, attempt *domain.AuthAttempt)
		assertStored  func(t *testing.T, stored *domain.AuthAttempt)
	}{
		{
			name: "no checks — Get returns the attempt with empty checks",
			attempt: &domain.AuthAttempt{
				ProjectID: "p",
				ID:        "a",
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				require.False(t, attempt.CreatedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				require.Equal(t, "p", stored.ProjectID)
				require.Equal(t, "a", stored.ID)
				require.Empty(t, stored.Checks)
				require.False(t, stored.CreatedAt.IsZero())
			},
		},
		{
			name: "password check — InitiatedAt set by storage and persisted",
			attempt: &domain.AuthAttempt{
				ProjectID:      "p",
				ID:             "a",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
				Checks: []domain.AuthChecker{
					&domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				require.False(t, attempt.CreatedAt.IsZero())
				require.False(t, attempt.Checks[0].Check().InitiatedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				require.Equal(t, []domain.AuthCheckType{domain.AuthCheckTypePassword}, stored.RequiredChecks)
				require.Len(t, stored.Checks, 1)
				_, ok := stored.Checks[0].(*domain.PasswordAuthCheck)
				require.True(t, ok, "expected *PasswordAuthCheck")
				require.False(t, stored.Checks[0].Check().InitiatedAt.IsZero())
			},
		},
		{
			// UserAuthCheck implements AuthFactorer so its payload is serialised into factor_payload.
			name: "user check — factor payload roundtrips via JSON",
			attempt: &domain.AuthAttempt{
				ProjectID:      "p",
				ID:             "a",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
				Checks: []domain.AuthChecker{
					&domain.UserAuthCheck{
						AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
						Factor:    &domain.UserFactor{UserID: "user-abc"},
					},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				require.False(t, attempt.CreatedAt.IsZero())
				require.False(t, attempt.Checks[0].Check().InitiatedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypeUser)
				require.True(t, ok)
				userCheck, ok := storedCheckRaw.(*domain.UserAuthCheck)
				require.True(t, ok, "expected *UserAuthCheck")
				require.Equal(t, "user-abc", userCheck.Factor.UserID)
			},
		},
		{
			name: "passkey check — challenge and factor payloads roundtrip via JSON",
			attempt: &domain.AuthAttempt{
				ProjectID:      "p",
				ID:             "a",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePasskey},
				Checks: []domain.AuthChecker{
					&domain.PasskeyAuthCheck{
						AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePasskey},
						Challenge: &domain.PasskeyAuthCheckChallenge{Challenge: "my-challenge"},
						Factor:    &domain.PasskeyAuthCheckFactor{UserVerified: true},
					},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				require.False(t, attempt.CreatedAt.IsZero())
				require.False(t, attempt.Checks[0].Check().InitiatedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypePasskey)
				require.True(t, ok)
				passkeyCheck, ok := storedCheckRaw.(*domain.PasskeyAuthCheck)
				require.True(t, ok, "expected *PasskeyAuthCheck")
				require.Equal(t, "my-challenge", passkeyCheck.Challenge.Challenge)
				require.True(t, passkeyCheck.Factor.UserVerified)
			},
		},
		{
			name: "all check types — each gets InitiatedAt; RequiredChecks and types preserved",
			attempt: &domain.AuthAttempt{
				ProjectID: "p",
				ID:        "a",
				RequiredChecks: []domain.AuthCheckType{
					domain.AuthCheckTypeUser,
					domain.AuthCheckTypePassword,
					domain.AuthCheckTypePasskey,
				},
				Checks: []domain.AuthChecker{
					&domain.UserAuthCheck{
						AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
						Factor:    &domain.UserFactor{UserID: "u1"},
					},
					&domain.PasswordAuthCheck{
						AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword},
					},
					&domain.PasskeyAuthCheck{
						AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePasskey},
					},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				require.False(t, attempt.CreatedAt.IsZero())
				for _, check := range attempt.Checks {
					require.False(t, check.Check().InitiatedAt.IsZero(),
						"InitiatedAt must be set for check type %d", check.Check().Type)
				}
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				require.ElementsMatch(t, []domain.AuthCheckType{
					domain.AuthCheckTypeUser,
					domain.AuthCheckTypePassword,
					domain.AuthCheckTypePasskey,
				}, stored.RequiredChecks)
				require.Len(t, stored.Checks, 3)
				_, ok := stored.CheckByType(domain.AuthCheckTypeUser)
				require.True(t, ok, "user check must be stored")
				_, ok = stored.CheckByType(domain.AuthCheckTypePassword)
				require.True(t, ok, "password check must be stored")
				_, ok = stored.CheckByType(domain.AuthCheckTypePasskey)
				require.True(t, ok, "passkey check must be stored")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx, rollback := transactionForRollback(t)
			defer rollback()

			require.NoError(t, repo.Create(t.Context(), tx, tt.attempt))
			tt.assertAttempt(t, tt.attempt)

			stored, err := repo.Get(t.Context(), tx, tt.attempt.ProjectID, tt.attempt.ID)
			require.NoError(t, err)
			tt.assertStored(t, stored)
		})
	}

	t.Run("duplicate ID returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		require.NoError(t, repo.Create(t.Context(), tx, &domain.AuthAttempt{ProjectID: "p-dup", ID: "a-dup"}))

		// Use a savepoint so the expected PK error does not abort the outer transaction.
		sp, spRollback := savepointForRollback(t, tx)
		err := repo.Create(t.Context(), sp, &domain.AuthAttempt{ProjectID: "p-dup", ID: "a-dup"})
		spRollback()
		require.Error(t, err)
	})
}

func TestAuthAttempt_Get(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("returns attempt without checks", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{
			ProjectID: "p-get-no-checks",
			ID:        "a-get-no-checks",
		}
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		stored, err := repo.Get(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		require.Equal(t, attempt.ProjectID, stored.ProjectID)
		require.Equal(t, attempt.ID, stored.ID)
		require.False(t, stored.CreatedAt.IsZero())
		require.Empty(t, stored.Checks)
	})

	t.Run("returns attempt with checks", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		created, _ := newTestAttempt(t, repo, tx, "p-get-with-checks", "a-get-with-checks")

		stored, err := repo.Get(t.Context(), tx, created.ProjectID, created.ID)
		require.NoError(t, err)
		require.Equal(t, created.ProjectID, stored.ProjectID)
		require.Equal(t, created.ID, stored.ID)
		require.Equal(t, created.RequiredChecks, stored.RequiredChecks)
		require.Len(t, stored.Checks, 1)
		storedCheck, ok := stored.CheckByType(domain.AuthCheckTypePassword)
		require.True(t, ok)
		require.False(t, storedCheck.Check().InitiatedAt.IsZero())
	})

	t.Run("missing attempt returns empty aggregate", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		stored, err := repo.Get(t.Context(), tx, "project-missing", "attempt-missing")
		require.NoError(t, err)
		require.Empty(t, stored.ID)
		require.Empty(t, stored.ProjectID)
		require.Empty(t, stored.Checks)
	})
}

func TestAuthAttempt_SetCheck(t *testing.T) {
	repo := new(repository.AuthAttempt)

	tests := []struct {
		name    string
		checker domain.AuthChecker
		assert  func(t *testing.T, stored *domain.AuthAttempt, checker domain.AuthChecker)
	}{
		{
			name:    "password check — initiated_at set and persisted",
			checker: &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}},
			assert: func(t *testing.T, stored *domain.AuthAttempt, checker domain.AuthChecker) {
				require.False(t, checker.Check().InitiatedAt.IsZero())
				storedCheck, ok := stored.CheckByType(domain.AuthCheckTypePassword)
				require.True(t, ok)
				require.Equal(t, checker.Check().InitiatedAt, storedCheck.Check().InitiatedAt)
			},
		},
		{
			name: "user check — factor payload stored and retrieved",
			checker: &domain.UserAuthCheck{
				AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
				Factor:    &domain.UserFactor{UserID: "set-user"},
			},
			assert: func(t *testing.T, stored *domain.AuthAttempt, checker domain.AuthChecker) {
				require.False(t, checker.Check().InitiatedAt.IsZero())
				storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypeUser)
				require.True(t, ok)
				userCheck, ok := storedCheckRaw.(*domain.UserAuthCheck)
				require.True(t, ok, "expected *UserAuthCheck")
				require.Equal(t, "set-user", userCheck.Factor.UserID)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx, rollback := transactionForRollback(t)
			defer rollback()

			// Create with no checks so SetCheck inserts the first check row.
			attempt := &domain.AuthAttempt{ProjectID: "p", ID: "a"}
			require.NoError(t, repo.Create(t.Context(), tx, attempt))

			require.NoError(t, repo.SetCheck(t.Context(), tx, attempt.ProjectID, attempt.ID, tt.checker))

			stored, err := repo.Get(t.Context(), tx, attempt.ProjectID, attempt.ID)
			require.NoError(t, err)
			tt.assert(t, stored, tt.checker)
		})
	}

	t.Run("upsert — initiated_at preserved, payload updated", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p", ID: "a"}
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		first := &domain.UserAuthCheck{
			AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
			Factor:    &domain.UserFactor{UserID: "original"},
		}
		require.NoError(t, repo.SetCheck(t.Context(), tx, attempt.ProjectID, attempt.ID, first))

		second := &domain.UserAuthCheck{
			AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
			Factor:    &domain.UserFactor{UserID: "updated"},
		}
		require.NoError(t, repo.SetCheck(t.Context(), tx, attempt.ProjectID, attempt.ID, second))

		// initiated_at must not be reset on upsert.
		require.Equal(t, first.Check().InitiatedAt, second.Check().InitiatedAt)

		// Factor payload must reflect the most recent SetCheck call.
		stored, err := repo.Get(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypeUser)
		require.True(t, ok)
		userCheck, ok := storedCheckRaw.(*domain.UserAuthCheck)
		require.True(t, ok, "expected *UserAuthCheck")
		require.Equal(t, "updated", userCheck.Factor.UserID)
	})
}

func TestAuthAttempt_Delete(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("cascades check deletion", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttempt(t, repo, tx, "p", "a")

		require.NoError(t, repo.Delete(t.Context(), tx, attempt.ProjectID, attempt.ID))

		// Get uses INNER JOIN with checks; returns an empty result when the parent row is gone.
		stored, err := repo.Get(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		require.Empty(t, stored.ID)
	})

	t.Run("non-existent attempt is a no-op", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		err := repo.Delete(t.Context(), tx, "project-ghost", "attempt-ghost")
		require.NoError(t, err)
	})
}

func TestAuthAttempt_CheckFailed(t *testing.T) {
	repo := new(repository.AuthAttempt)

	tests := []struct {
		name         string
		failureCount int
	}{
		{"single failure sets count and last_failed_at", 1},
		{"three consecutive failures increment count monotonically", 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx, rollback := transactionForRollback(t)
			defer rollback()

			_, check := newTestAttempt(t, repo, tx, "p", "a")

			for i := range tt.failureCount {
				prev := check.LastFailedAt

				require.NoError(t, repo.CheckFailed(t.Context(), tx, "p", "a", check.AuthCheck))
				require.NotNil(t, check.LastFailedAt, "LastFailedAt must be set after failure %d", i+1)
				require.Equal(t, uint16(i+1), check.FailureCount)
				if prev != nil {
					require.False(t, check.LastFailedAt.Before(*prev),
						"LastFailedAt must not decrease between consecutive failures")
				}
			}
		})
	}
}

func TestAuthAttempt_CheckSucceeded(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("sets verified_at and persists it", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		_, check := newTestAttempt(t, repo, tx, "p", "a")
		require.True(t, check.VerifiedAt.IsZero(), "VerifiedAt must be zero before success")

		require.NoError(t, repo.CheckSucceeded(t.Context(), tx, "p", "a", check.AuthCheck))
		require.False(t, check.VerifiedAt.IsZero())

		stored, err := repo.Get(t.Context(), tx, "p", "a")
		require.NoError(t, err)
		storedCheck, ok := stored.CheckByType(domain.AuthCheckTypePassword)
		require.True(t, ok)
		require.Equal(t, check.VerifiedAt, storedCheck.Check().VerifiedAt)
	})

	t.Run("succeeds after previous failures; failure_count is not reset", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		_, check := newTestAttempt(t, repo, tx, "p", "a")
		require.NoError(t, repo.CheckFailed(t.Context(), tx, "p", "a", check.AuthCheck))
		require.NoError(t, repo.CheckFailed(t.Context(), tx, "p", "a", check.AuthCheck))
		require.Equal(t, uint16(2), check.FailureCount)

		require.NoError(t, repo.CheckSucceeded(t.Context(), tx, "p", "a", check.AuthCheck))
		require.False(t, check.VerifiedAt.IsZero())

		// CheckSucceeded does not reset failure_count (current intended behaviour).
		stored, err := repo.Get(t.Context(), tx, "p", "a")
		require.NoError(t, err)
		storedCheck, ok := stored.CheckByType(domain.AuthCheckTypePassword)
		require.True(t, ok)
		require.False(t, storedCheck.Check().VerifiedAt.IsZero())
		require.Equal(t, uint16(2), storedCheck.Check().FailureCount)
	})
}

func TestAuthAttempt_Complete(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("sets completed_at on the attempt", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttempt(t, repo, tx, "p", "a")
		require.Nil(t, attempt.CompletedAt, "CompletedAt must be nil before Complete is called")

		require.NoError(t, repo.Complete(t.Context(), tx, attempt))
		require.NotNil(t, attempt.CompletedAt)
		require.False(t, attempt.CompletedAt.IsZero())
	})

	t.Run("calling Complete twice updates completed_at", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttempt(t, repo, tx, "p", "a")
		require.NoError(t, repo.Complete(t.Context(), tx, attempt))
		first := *attempt.CompletedAt

		require.NoError(t, repo.Complete(t.Context(), tx, attempt))
		require.NotNil(t, attempt.CompletedAt)
		require.False(t, attempt.CompletedAt.Before(first),
			"second CompletedAt must not be before the first")
	})
}
