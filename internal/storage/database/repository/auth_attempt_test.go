package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func ensureProject(t *testing.T, client database.QueryExecutor, projectID string) {
	t.Helper()
	_, err := client.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.instances (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
		projectID,
	)
	require.NoError(t, err)
}

// newTestAttempt inserts an auth attempt with one password check into the given executor.
// It returns the attempt and the pre-created check so callers can reference the same objects.
func newTestAttempt(t *testing.T, repo *repository.AuthAttempt, client database.QueryExecutor, projectID, attemptID string) (*domain.AuthAttempt, *domain.PasswordAuthCheck) {
	t.Helper()
	ensureProject(t, client, projectID)
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
				assert.False(t, attempt.CreatedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				assert.Equal(t, "p", stored.ProjectID)
				assert.Equal(t, "a", stored.ID)
				assert.Empty(t, stored.Checks)
				assert.False(t, stored.CreatedAt.IsZero())
			},
		},
		{
			name: "password check - create sets challenge timestamp but not verification timestamp",
			attempt: &domain.AuthAttempt{
				ProjectID:      "p",
				ID:             "a",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
				Checks: []domain.AuthChecker{
					&domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				assert.False(t, attempt.CreatedAt.IsZero())
				check := attempt.Checks[0].Check()
				assert.False(t, check.LastChallengedAt.IsZero())
				assert.True(t, check.LastVerifiedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				assert.Equal(t, []domain.AuthCheckType{domain.AuthCheckTypePassword}, stored.RequiredChecks)
				require.Len(t, stored.Checks, 1) // gates index access below
				_, ok := stored.Checks[0].(*domain.PasswordAuthCheck)
				assert.True(t, ok, "expected *PasswordAuthCheck")
				assert.False(t, stored.Checks[0].Check().LastChallengedAt.IsZero())
				assert.True(t, stored.Checks[0].Check().LastVerifiedAt.IsZero())
			},
		},
		{
			name: "user check - factor payload roundtrips and create sets verified timestamp",
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
				assert.False(t, attempt.CreatedAt.IsZero())
				check := attempt.Checks[0].Check()
				assert.True(t, check.LastChallengedAt.IsZero())
				assert.False(t, check.LastVerifiedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypeUser)
				require.True(t, ok) // gates type assertion below
				userCheck, ok := storedCheckRaw.(*domain.UserAuthCheck)
				require.True(t, ok, "expected *UserAuthCheck") // gates field access below
				assert.Equal(t, "user-abc", userCheck.Factor.UserID)
			},
		},
		{
			name: "passkey check - challenge and factor payloads roundtrip and create sets challenge timestamp only",
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
				assert.False(t, attempt.CreatedAt.IsZero())
				check := attempt.Checks[0].Check()
				assert.False(t, check.LastChallengedAt.IsZero())
				assert.True(t, check.LastVerifiedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypePasskey)
				require.True(t, ok) // gates type assertion below
				passkeyCheck, ok := storedCheckRaw.(*domain.PasskeyAuthCheck)
				require.True(t, ok, "expected *PasskeyAuthCheck") // gates field access below
				assert.Equal(t, "my-challenge", passkeyCheck.Challenge.Challenge)
				assert.True(t, passkeyCheck.Factor.UserVerified)
			},
		},
		{
			name: "all check types - challenge and verify timestamps are set per checker capabilities",
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
						Challenge: &domain.PasskeyAuthCheckChallenge{Challenge: "challenge"},
						Factor:    &domain.PasskeyAuthCheckFactor{UserVerified: true},
					},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				assert.False(t, attempt.CreatedAt.IsZero())

				userCheckRaw, ok := attempt.CheckByType(domain.AuthCheckTypeUser)
				require.True(t, ok) // gates .Check() call below
				assert.True(t, userCheckRaw.Check().LastChallengedAt.IsZero())
				assert.False(t, userCheckRaw.Check().LastVerifiedAt.IsZero())

				passwordCheckRaw, ok := attempt.CheckByType(domain.AuthCheckTypePassword)
				require.True(t, ok) // gates .Check() call below
				assert.False(t, passwordCheckRaw.Check().LastChallengedAt.IsZero())
				assert.True(t, passwordCheckRaw.Check().LastVerifiedAt.IsZero())

				passkeyCheckRaw, ok := attempt.CheckByType(domain.AuthCheckTypePasskey)
				require.True(t, ok) // gates .Check() call below
				assert.False(t, passkeyCheckRaw.Check().LastChallengedAt.IsZero())
				assert.True(t, passkeyCheckRaw.Check().LastVerifiedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				assert.ElementsMatch(t, []domain.AuthCheckType{
					domain.AuthCheckTypeUser,
					domain.AuthCheckTypePassword,
					domain.AuthCheckTypePasskey,
				}, stored.RequiredChecks)
				assert.Len(t, stored.Checks, 3)
				_, ok := stored.CheckByType(domain.AuthCheckTypeUser)
				assert.True(t, ok, "user check must be stored")
				_, ok = stored.CheckByType(domain.AuthCheckTypePassword)
				assert.True(t, ok, "password check must be stored")
				_, ok = stored.CheckByType(domain.AuthCheckTypePasskey)
				assert.True(t, ok, "passkey check must be stored")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx, rollback := transactionForRollback(t)
			defer rollback()

			ensureProject(t, tx, tt.attempt.ProjectID)
			require.NoError(t, repo.Create(t.Context(), tx, tt.attempt))
			tt.assertAttempt(t, tt.attempt)

			stored, err := repo.GetByID(t.Context(), tx, tt.attempt.ProjectID, tt.attempt.ID)
			require.NoError(t, err)
			tt.assertStored(t, stored)
		})
	}

	t.Run("duplicate ID returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ensureProject(t, tx, "p-dup")
		require.NoError(t, repo.Create(t.Context(), tx, &domain.AuthAttempt{ProjectID: "p-dup", ID: "a-dup"}))

		// Use a savepoint so the expected PK error does not abort the outer transaction.
		sp, spRollback := savepointForRollback(t, tx)
		err := repo.Create(t.Context(), sp, &domain.AuthAttempt{ProjectID: "p-dup", ID: "a-dup"})
		spRollback()
		assert.Error(t, err)
	})
}

func TestAuthAttempt_GetByID(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("returns attempt without checks", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{
			ProjectID: "p-get-no-checks",
			ID:        "a-get-no-checks",
		}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		assert.Equal(t, attempt.ProjectID, stored.ProjectID)
		assert.Equal(t, attempt.ID, stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.Empty(t, stored.Checks)
	})

	t.Run("returns attempt with session id", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		sessionID := "session-123"
		attempt := &domain.AuthAttempt{
			ProjectID: "p-get-session",
			ID:        "a-get-session",
			SessionID: &sessionID,
		}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		require.NotNil(t, stored.SessionID)
		assert.Equal(t, sessionID, *stored.SessionID)
	})

	t.Run("returns attempt with ttl", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ttl := 5 * time.Minute
		attempt := &domain.AuthAttempt{
			ProjectID:  "p-get-ttl",
			ID:         "a-get-ttl",
			TimeToLive: &ttl,
		}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		require.NotNil(t, stored.TimeToLive)
		assert.Equal(t, ttl, *stored.TimeToLive)
	})

	t.Run("returns attempt with checks", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		created, _ := newTestAttempt(t, repo, tx, "p-get-with-checks", "a-get-with-checks")

		stored, err := repo.GetByID(t.Context(), tx, created.ProjectID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ProjectID, stored.ProjectID)
		assert.Equal(t, created.ID, stored.ID)
		assert.Equal(t, created.RequiredChecks, stored.RequiredChecks)
		assert.Len(t, stored.Checks, 1)
		_, ok := stored.CheckByType(domain.AuthCheckTypePassword)
		assert.True(t, ok)
	})

	t.Run("missing attempt returns empty aggregate", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		stored, err := repo.GetByID(t.Context(), tx, "project-missing", "attempt-missing")
		require.NoError(t, err)
		assert.Empty(t, stored.ID)
		assert.Empty(t, stored.ProjectID)
		assert.Empty(t, stored.Checks)
	})
}

func TestAuthAttempt_SetChallenge(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("sets last_challenged_at and persists challenge payload", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p", ID: "a"}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		checker := &domain.PasskeyAuthCheck{
			AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePasskey},
			Challenge: &domain.PasskeyAuthCheckChallenge{Challenge: "set-challenge"},
		}
		require.NoError(t, repo.SetChallenge(t.Context(), tx, attempt.ProjectID, attempt.ID, checker))
		assert.False(t, checker.Check().LastChallengedAt.IsZero())

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypePasskey)
		require.True(t, ok) // gates type assertion below
		storedCheck, ok := storedCheckRaw.(*domain.PasskeyAuthCheck)
		require.True(t, ok) // gates field access below
		assert.Equal(t, "set-challenge", storedCheck.Challenge.Challenge)
	})

	t.Run("resets failure metadata when challenge is set again", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p", ID: "a"}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		checker := &domain.PasskeyAuthCheck{
			AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePasskey},
			Challenge: &domain.PasskeyAuthCheckChallenge{Challenge: "first"},
		}
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, attempt.ProjectID, attempt.ID, checker.AuthCheck))
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, attempt.ProjectID, attempt.ID, checker.AuthCheck))
		assert.Equal(t, uint16(2), checker.Check().FailureCount)
		assert.NotNil(t, checker.Check().LastFailedAt)

		checker.Challenge = &domain.PasskeyAuthCheckChallenge{Challenge: "second"}
		require.NoError(t, repo.SetChallenge(t.Context(), tx, attempt.ProjectID, attempt.ID, checker))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypePasskey)
		require.True(t, ok) // gates .Check() call below
		assert.Equal(t, uint16(0), storedCheckRaw.Check().FailureCount)
		assert.Nil(t, storedCheckRaw.Check().LastFailedAt)
	})
}

func TestAuthAttempt_Delete(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("cascades check deletion", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttempt(t, repo, tx, "p", "a")

		require.NoError(t, repo.Delete(t.Context(), tx, attempt.ProjectID, attempt.ID))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		assert.Empty(t, stored.ID)
	})

	t.Run("non-existent attempt is a no-op", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		err := repo.Delete(t.Context(), tx, "project-ghost", "attempt-ghost")
		assert.NoError(t, err)
	})
}

func TestAuthAttempt_ChallengeFailed(t *testing.T) {
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

				require.NoError(t, repo.ChallengeFailed(t.Context(), tx, "p", "a", check.AuthCheck))
				require.NotNil(t, check.LastFailedAt, "LastFailedAt must be set after failure %d", i+1) // gates dereference below
				assert.Equal(t, uint16(i+1), check.FailureCount)
				if prev != nil {
					assert.False(t, check.LastFailedAt.Before(*prev),
						"LastFailedAt must not decrease between consecutive failures")
				}
			}
		})
	}
}

func TestAuthAttempt_ChallengeSucceeded(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("sets verified_at and persists it", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		_, check := newTestAttempt(t, repo, tx, "p", "a")
		previousVerifiedAt := check.LastVerifiedAt

		require.NoError(t, repo.ChallengeSucceeded(t.Context(), tx, "p", "a", check.AuthCheck))
		assert.False(t, check.LastVerifiedAt.IsZero())
		assert.True(t, check.LastVerifiedAt.After(previousVerifiedAt) || check.LastVerifiedAt.Equal(previousVerifiedAt))

		stored, err := repo.GetByID(t.Context(), tx, "p", "a")
		require.NoError(t, err)
		storedCheck, ok := stored.CheckByType(domain.AuthCheckTypePassword)
		require.True(t, ok) // gates .Check() call below
		assert.Equal(t, check.LastVerifiedAt, storedCheck.Check().LastVerifiedAt)
	})

	t.Run("succeeds after previous failures; failure_count is not reset", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		_, check := newTestAttempt(t, repo, tx, "p", "a")
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, "p", "a", check.AuthCheck))
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, "p", "a", check.AuthCheck))
		assert.Equal(t, uint16(2), check.FailureCount)

		require.NoError(t, repo.ChallengeSucceeded(t.Context(), tx, "p", "a", check.AuthCheck))
		assert.False(t, check.LastVerifiedAt.IsZero())

		stored, err := repo.GetByID(t.Context(), tx, "p", "a")
		require.NoError(t, err)
		storedCheck, ok := stored.CheckByType(domain.AuthCheckTypePassword)
		require.True(t, ok) // gates .Check() call below
		assert.False(t, storedCheck.Check().LastVerifiedAt.IsZero())
		assert.Equal(t, uint16(2), storedCheck.Check().FailureCount)
	})

	t.Run("stores factor payload when checker implements AuthFactorer", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p", ID: "a"}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		userCheck := &domain.UserAuthCheck{
			AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
			Factor:    &domain.UserFactor{UserID: "verified-user"},
		}
		require.NoError(t, repo.ChallengeSucceeded(t.Context(), tx, attempt.ProjectID, attempt.ID, userCheck))
		assert.False(t, userCheck.Check().LastVerifiedAt.IsZero())

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheckRaw, ok := stored.CheckByType(domain.AuthCheckTypeUser)
		require.True(t, ok) // gates type assertion below
		storedCheck, ok := storedCheckRaw.(*domain.UserAuthCheck)
		require.True(t, ok) // gates field access below
		assert.Equal(t, "verified-user", storedCheck.Factor.UserID)
	})
}

func TestAuthAttempt_Complete(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("non existing attempt", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{
			ProjectID: "p",
			ID:        "non-existing",
		}

		err := repo.Complete(t.Context(), tx, attempt)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		assert.Nil(t, attempt.CompletedAt)
	})

	t.Run("sets completed_at on the attempt", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttempt(t, repo, tx, "p", "a")
		assert.Nil(t, attempt.CompletedAt, "CompletedAt must be nil before Complete is called")

		require.NoError(t, repo.Complete(t.Context(), tx, attempt))
		require.NotNil(t, attempt.CompletedAt) // gates .IsZero() call below
		assert.False(t, attempt.CompletedAt.IsZero())
	})

	t.Run("calling Complete twice updates completed_at", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttempt(t, repo, tx, "p", "a")
		require.NoError(t, repo.Complete(t.Context(), tx, attempt))
		first := *attempt.CompletedAt

		require.NoError(t, repo.Complete(t.Context(), tx, attempt))
		require.NotNil(t, attempt.CompletedAt) // gates .Before() call below
		assert.False(t, attempt.CompletedAt.Before(first),
			"second CompletedAt must not be before the first")
	})
}

func TestAuthAttempt_Handoff(t *testing.T) {
	repo := new(repository.AuthAttempt)

	t.Run("stores handoff token and handed off timestamp", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		token := "handoff-token"
		attempt := &domain.AuthAttempt{ProjectID: "p", ID: "a", HandoffToken: &token}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		require.NoError(t, repo.Handoff(t.Context(), tx, attempt))
		require.NotNil(t, attempt.HandedOffAt)
		assert.False(t, attempt.HandedOffAt.IsZero())

		stored, err := repo.GetByHandoffToken(t.Context(), tx, attempt.ProjectID, token)
		require.NoError(t, err)
		assert.Equal(t, attempt.ID, stored.ID)
		require.NotNil(t, stored.HandoffToken)
		assert.Equal(t, token, *stored.HandoffToken)
		require.NotNil(t, stored.HandedOffAt)
		assert.False(t, stored.HandedOffAt.IsZero())
	})

	t.Run("returns error when handoff token is missing", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p", ID: "a"}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		err := repo.Handoff(t.Context(), tx, attempt)
		require.Error(t, err)
	})
}
