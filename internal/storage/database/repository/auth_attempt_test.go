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

// newTestAttempt inserts an auth attempt with one password factor into the given executor.
// It returns the attempt and the factor so callers can reference the same objects.
func newTestAttemptWithFactor(t *testing.T, repo domain.AuthAttemptRepository, client database.QueryExecutor, projectID string) (*domain.AuthAttempt, *domain.AuthFactorPassword) {
	t.Helper()
	ensureProject(t, client, projectID)
	check := &domain.AuthFactorPassword{}
	attempt := &domain.AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{check},
	}
	require.NoError(t, repo.Create(t.Context(), client, attempt))
	require.NotEmpty(t, attempt.ID)
	return attempt, check
}

// newTestAttempt inserts an auth attempt with one password challenge into the given executor.
// It returns the attempt and the challenge so callers can reference the same objects.
func newTestAttemptWithChallenge(t *testing.T, repo domain.AuthAttemptRepository, client database.QueryExecutor, projectID string) (*domain.AuthAttempt, *domain.AuthChallengePassword) {
	t.Helper()
	ensureProject(t, client, projectID)
	check := &domain.AuthChallengePassword{}
	attempt := &domain.AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{check},
	}
	require.NoError(t, repo.Create(t.Context(), client, attempt))
	require.NotEmpty(t, attempt.ID)
	return attempt, check
}

func TestAuthAttempt_Create(t *testing.T) {
	repo := repository.NewAuthAttemptRepository(pool)

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
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				assert.NotEmpty(t, attempt.ID)
				assert.False(t, attempt.CreatedAt.IsZero())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				assert.Equal(t, "p", stored.ProjectID)
				assert.NotEmpty(t, stored.ID)
				assert.Empty(t, stored.Checks)
				assert.False(t, stored.CreatedAt.IsZero())
			},
		},
		{
			name: "password check - create sets challenge timestamp but not verification timestamp",
			attempt: &domain.AuthAttempt{
				ProjectID:      "p",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
				Checks: []domain.AuthCheck{
					&domain.AuthChallengePassword{},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				assert.False(t, attempt.CreatedAt.IsZero())
				challenge, ok := attempt.Checks[0].(domain.AuthChallenge)
				require.True(t, ok, "expected check to implement AuthChallenge")
				assert.NotZero(t, challenge.GetLastChallengedAt())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				assert.Equal(t, []domain.AuthCheckType{domain.AuthCheckTypePassword}, stored.RequiredChecks)
				require.Len(t, stored.Checks, 1) // gates index access below
				challenge, ok := stored.Checks[0].(*domain.AuthChallengePassword)
				assert.True(t, ok, "expected *PasswordAuthCheck")
				assert.NotZero(t, challenge.GetLastChallengedAt())
			},
		},
		{
			name: "user check - factor payload roundtrips and create sets verified timestamp",
			attempt: &domain.AuthAttempt{
				ProjectID:      "p",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
				Checks: []domain.AuthCheck{
					&domain.AuthFactorUser{UserID: "user-abc"},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				assert.NotZero(t, attempt.CreatedAt)
				check, ok := attempt.Checks[0].(domain.AuthFactor)
				assert.True(t, ok, "expected check to implement AuthFactor")
				assert.NotZero(t, check.GetLastVerifiedAt())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				storedCheckRaw, ok := stored.FactorByType(domain.AuthCheckTypeUser)
				require.True(t, ok) // gates type assertion below
				userCheck, ok := storedCheckRaw.(*domain.AuthFactorUser)
				require.True(t, ok, "expected *UserAuthCheck") // gates field access below
				assert.Equal(t, "user-abc", userCheck.UserID)
			},
		},
		{
			name: "all challenge types",
			attempt: &domain.AuthAttempt{
				ProjectID: "p",
				RequiredChecks: []domain.AuthCheckType{
					domain.AuthCheckTypeUser,
					domain.AuthCheckTypePassword,
					domain.AuthCheckTypePasskey,
				},
				Checks: []domain.AuthCheck{
					&domain.AuthChallengeUser{},
					&domain.AuthChallengePassword{},
					&domain.AuthChallengePasskey{PasskeyChallenge: &domain.PasskeyChallenge{Challenge: "challenge"}},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				assert.False(t, attempt.CreatedAt.IsZero())

				userCheckRaw, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
				require.True(t, ok) // gates call below
				assert.NotZero(t, userCheckRaw.GetLastChallengedAt())

				passwordCheckRaw, ok := attempt.ChallengeByType(domain.AuthCheckTypePassword)
				require.True(t, ok) // gates call below
				assert.NotZero(t, passwordCheckRaw.GetLastChallengedAt())

				passkeyCheckRaw, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskey)
				require.True(t, ok) // gates call below
				assert.NotZero(t, passkeyCheckRaw.GetLastChallengedAt())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				assert.ElementsMatch(t, []domain.AuthCheckType{
					domain.AuthCheckTypeUser,
					domain.AuthCheckTypePassword,
					domain.AuthCheckTypePasskey,
				}, stored.RequiredChecks)
				assert.Len(t, stored.Checks, 3)
				_, ok := stored.ChallengeByType(domain.AuthCheckTypeUser)
				assert.True(t, ok, "user check must be stored")
				_, ok = stored.ChallengeByType(domain.AuthCheckTypePassword)
				assert.True(t, ok, "password check must be stored")
				_, ok = stored.ChallengeByType(domain.AuthCheckTypePasskey)
				assert.True(t, ok, "passkey check must be stored")
			},
		},
		{
			name: "all factor types",
			attempt: &domain.AuthAttempt{
				ProjectID: "p",
				RequiredChecks: []domain.AuthCheckType{
					domain.AuthCheckTypeUser,
					domain.AuthCheckTypePassword,
					domain.AuthCheckTypePasskey,
				},
				Checks: []domain.AuthCheck{
					&domain.AuthFactorUser{UserID: "verified-user"},
					&domain.AuthFactorPassword{},
					&domain.AuthFactorPasskey{},
				},
			},
			assertAttempt: func(t *testing.T, attempt *domain.AuthAttempt) {
				assert.False(t, attempt.CreatedAt.IsZero())

				userCheckRaw, ok := attempt.FactorByType(domain.AuthCheckTypeUser)
				require.True(t, ok) // gates call below
				assert.NotZero(t, userCheckRaw.GetLastVerifiedAt())

				passwordCheckRaw, ok := attempt.FactorByType(domain.AuthCheckTypePassword)
				require.True(t, ok) // gates call below
				assert.NotZero(t, passwordCheckRaw.GetLastVerifiedAt())

				passkeyCheckRaw, ok := attempt.FactorByType(domain.AuthCheckTypePasskey)
				require.True(t, ok) // gates call below
				assert.NotZero(t, passkeyCheckRaw.GetLastVerifiedAt())
			},
			assertStored: func(t *testing.T, stored *domain.AuthAttempt) {
				assert.ElementsMatch(t, []domain.AuthCheckType{
					domain.AuthCheckTypeUser,
					domain.AuthCheckTypePassword,
					domain.AuthCheckTypePasskey,
				}, stored.RequiredChecks)
				assert.Len(t, stored.Checks, 3)
				_, ok := stored.FactorByType(domain.AuthCheckTypeUser)
				assert.True(t, ok, "user check must be stored")
				_, ok = stored.FactorByType(domain.AuthCheckTypePassword)
				assert.True(t, ok, "password check must be stored")
				_, ok = stored.FactorByType(domain.AuthCheckTypePasskey)
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

	t.Run("two creates receive distinct database-generated ids", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ensureProject(t, tx, "p-dup")
		first := &domain.AuthAttempt{ProjectID: "p-dup"}
		second := &domain.AuthAttempt{ProjectID: "p-dup"}
		require.NoError(t, repo.Create(t.Context(), tx, first))
		require.NoError(t, repo.Create(t.Context(), tx, second))
		assert.NotEmpty(t, first.ID)
		assert.NotEmpty(t, second.ID)
		assert.NotEqual(t, first.ID, second.ID)
	})
}

func TestAuthAttempt_GetByID(t *testing.T) {
	repo := repository.NewAuthAttemptRepository(pool)

	t.Run("returns attempt without checks", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{
			ProjectID: "p-get-no-checks",
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

		sessionID := "42"
		attempt := &domain.AuthAttempt{
			ProjectID: "p-get-session",
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

		created, _ := newTestAttemptWithFactor(t, repo, tx, "p-get-with-checks")

		stored, err := repo.GetByID(t.Context(), tx, created.ProjectID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ProjectID, stored.ProjectID)
		assert.Equal(t, created.ID, stored.ID)
		assert.Equal(t, created.RequiredChecks, stored.RequiredChecks)
		assert.Len(t, stored.Checks, 1)
		_, ok := stored.FactorByType(domain.AuthCheckTypePassword)
		assert.True(t, ok)
	})

	t.Run("missing attempt returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		stored, err := repo.GetByID(t.Context(), tx, "project-missing", "999999")
		require.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
		assert.Empty(t, stored.ID)
		assert.Empty(t, stored.ProjectID)
		assert.Empty(t, stored.Checks)
	})
}

func TestAuthAttempt_SetChallenge(t *testing.T) {
	repo := repository.NewAuthAttemptRepository(pool)

	t.Run("sets last_challenged_at and persists challenge payload", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p"}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		challenge := &domain.AuthChallengePasskey{PasskeyChallenge: &domain.PasskeyChallenge{Challenge: "set-challenge"}}
		require.NoError(t, repo.SetChallenge(t.Context(), tx, attempt.ProjectID, attempt.ID, challenge))
		assert.NotZero(t, challenge.LastChallengedAt)

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheckRaw, ok := stored.ChallengeByType(domain.AuthCheckTypePasskey)
		require.True(t, ok) // gates type assertion below
		storedCheck, ok := storedCheckRaw.(*domain.AuthChallengePasskey)
		require.True(t, ok) // gates field access below
		assert.Equal(t, "set-challenge", storedCheck.Challenge)
	})

	t.Run("resets failure metadata when challenge is set again", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p"}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		challenge := &domain.AuthChallengePasskey{PasskeyChallenge: &domain.PasskeyChallenge{Challenge: "second"}}
		require.NoError(t, repo.SetChallenge(t.Context(), tx, attempt.ProjectID, attempt.ID, challenge))
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, attempt.ProjectID, attempt.ID, challenge))
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, attempt.ProjectID, attempt.ID, challenge))
		assert.Equal(t, uint16(2), challenge.FailureCount)
		assert.NotNil(t, challenge.LastFailedAt)

		challenge = &domain.AuthChallengePasskey{PasskeyChallenge: &domain.PasskeyChallenge{Challenge: "second"}}
		require.NoError(t, repo.SetChallenge(t.Context(), tx, attempt.ProjectID, attempt.ID, challenge))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheckRaw, ok := stored.ChallengeByType(domain.AuthCheckTypePasskey)
		require.True(t, ok) // gates .Check() call below
		assert.Equal(t, uint16(0), storedCheckRaw.GetFailureCount())
		assert.Zero(t, storedCheckRaw.GetLastFailedAt())
	})
}

func TestAuthAttempt_Delete(t *testing.T) {
	repo := repository.NewAuthAttemptRepository(pool)

	t.Run("cascades check deletion", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttemptWithFactor(t, repo, tx, "p")

		require.NoError(t, repo.Delete(t.Context(), tx, attempt.ProjectID, attempt.ID))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
		assert.Empty(t, stored.ID)
	})

	t.Run("non-existent attempt is a no-op", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		err := repo.Delete(t.Context(), tx, "project-ghost", "999999")
		assert.NoError(t, err)
	})
}

func TestAuthAttempt_ChallengeFailed(t *testing.T) {
	repo := repository.NewAuthAttemptRepository(pool)

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

			attempt, check := newTestAttemptWithChallenge(t, repo, tx, "p")

			for i := range tt.failureCount {
				prev := check.LastFailedAt

				require.NoError(t, repo.ChallengeFailed(t.Context(), tx, attempt.ProjectID, attempt.ID, check))
				require.NotNil(t, check.LastFailedAt, "LastFailedAt must be set after failure %d", i+1) // gates dereference below
				assert.Equal(t, uint16(i+1), check.FailureCount)
				if !prev.IsZero() {
					assert.False(t, check.LastFailedAt.Before(prev),
						"LastFailedAt must not decrease between consecutive failures")
				}
			}
		})
	}
}

func TestAuthAttempt_ChallengeSucceeded(t *testing.T) {
	repo := repository.NewAuthAttemptRepository(pool)

	t.Run("sets verified_at and persists it", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, challenge := newTestAttemptWithChallenge(t, repo, tx, "p")

		factor := &domain.AuthFactorPassword{}
		previousVerifiedAt := factor.LastVerifiedAt
		require.NoError(t, repo.Create(t.Context(), tx, attempt))
		require.NoError(t, repo.ChallengeSucceeded(t.Context(), tx, attempt.ProjectID, attempt.ID, factor, challenge.GetID()))
		assert.NotZero(t, factor.LastVerifiedAt)
		assert.True(t, factor.LastVerifiedAt.After(previousVerifiedAt) || factor.LastVerifiedAt.Equal(previousVerifiedAt))

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheck, ok := stored.FactorByType(domain.AuthCheckTypePassword)
		require.True(t, ok) // gates .Check() call below
		assert.Equal(t, factor.LastVerifiedAt, storedCheck.GetLastVerifiedAt())
	})

	t.Run("succeeds after previous failures; failure_count is not reset", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, challenge := newTestAttemptWithChallenge(t, repo, tx, "p")
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, attempt.ProjectID, attempt.ID, challenge))
		require.NoError(t, repo.ChallengeFailed(t.Context(), tx, attempt.ProjectID, attempt.ID, challenge))
		assert.Equal(t, uint16(2), challenge.FailureCount)

		factor := &domain.AuthFactorPassword{}
		require.NoError(t, repo.ChallengeSucceeded(t.Context(), tx, attempt.ProjectID, attempt.ID, factor, challenge.GetID()))
		assert.NotZero(t, factor.LastVerifiedAt)

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheck, ok := stored.FactorByType(domain.AuthCheckTypePassword)
		require.True(t, ok) // gates .Check() call below
		assert.NotZero(t, storedCheck.GetLastVerifiedAt())
	})

	t.Run("stores factor payload when check implements AuthFactor", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt, _ := newTestAttemptWithChallenge(t, repo, tx, "p")

		userChallenge := &domain.AuthChallengeUser{}
		require.NoError(t, repo.SetChallenge(t.Context(), tx, attempt.ProjectID, attempt.ID, userChallenge))

		userFactor := &domain.AuthFactorUser{UserID: "verified-user"}
		require.NoError(t, repo.ChallengeSucceeded(t.Context(), tx, attempt.ProjectID, attempt.ID, userFactor, userChallenge.GetID()))
		assert.NotZero(t, userFactor.LastVerifiedAt)

		stored, err := repo.GetByID(t.Context(), tx, attempt.ProjectID, attempt.ID)
		require.NoError(t, err)
		storedCheckRaw, ok := stored.FactorByType(domain.AuthCheckTypeUser)
		require.True(t, ok) // gates type assertion below
		storedCheck, ok := storedCheckRaw.(*domain.AuthFactorUser)
		require.True(t, ok) // gates field access below
		assert.Equal(t, "verified-user", storedCheck.UserID)
	})
}

func TestAuthAttempt_Handoff(t *testing.T) {
	repo := repository.NewAuthAttemptRepository(pool)

	t.Run("stores handoff token and handed off timestamp", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		token := []byte("handoff-token")
		attempt := &domain.AuthAttempt{ProjectID: "p", HandoffToken: &domain.HandoffToken{TokenHash: token}}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		require.NoError(t, repo.Handoff(t.Context(), tx, attempt))
		require.NotNil(t, attempt.HandedOffAt)
		assert.False(t, attempt.HandedOffAt.IsZero())

		stored, err := repo.GetByHandoffToken(t.Context(), tx, attempt.ProjectID, token)
		require.NoError(t, err)
		assert.Equal(t, attempt.ID, stored.ID)
		require.NotNil(t, stored.HandoffToken)
		assert.Equal(t, token, stored.HandoffToken.TokenHash)
		require.NotNil(t, stored.HandedOffAt)
		assert.False(t, stored.HandedOffAt.IsZero())
	})

	t.Run("returns error when handoff token is missing", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		attempt := &domain.AuthAttempt{ProjectID: "p"}
		ensureProject(t, tx, attempt.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, attempt))

		err := repo.Handoff(t.Context(), tx, attempt)
		require.Error(t, err)
	})
}
