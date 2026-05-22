package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestNewAuthAttempt(t *testing.T) {
	projectID := "proj-123"
	required := []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}

	t.Run("creates attempt with defaults", func(t *testing.T) {
		attempt, err := domain.NewAuthAttempt(projectID, required)
		require.NoError(t, err)
		assert.Equal(t, projectID, attempt.ProjectID)
		assert.Equal(t, required, attempt.RequiredChecks)
		assert.NotNil(t, attempt.TimeToLive)
		assert.Equal(t, domain.AuthAttemptTTL, *attempt.TimeToLive)
		assert.Nil(t, attempt.SessionID)
		assert.Empty(t, attempt.Checks)
	})

	t.Run("applies options like WithSession", func(t *testing.T) {
		sessionID := "sess-abc"
		userFactor := domain.SetAuthFactorUser(time.Now())
		userFactor.UserID = "user-123"

		attempt, err := domain.NewAuthAttempt(projectID, required, domain.WithSession(&sessionID, userFactor))
		require.NoError(t, err)
		assert.Equal(t, &sessionID, attempt.SessionID)
		require.Len(t, attempt.Checks, 1)
		assert.Equal(t, userFactor, attempt.Checks[0])
	})
}

func TestCheckAs(t *testing.T) {
	userFactor := domain.SetAuthFactorUser(time.Now())
	userFactor.UserID = "user-123"

	attempt := &domain.AuthAttempt{
		Checks: []domain.AuthCheck{userFactor},
	}

	t.Run("type match returns factor and true", func(t *testing.T) {
		factor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
		assert.True(t, ok)
		assert.Equal(t, userFactor, factor)
	})

	t.Run("type mismatch returns zero and false", func(t *testing.T) {
		factor, ok := domain.CheckAs[*domain.AuthFactorPassword](attempt, domain.AuthCheckTypeUser)
		assert.False(t, ok)
		assert.Nil(t, factor)
	})

	t.Run("check not found returns zero and false", func(t *testing.T) {
		factor, ok := domain.CheckAs[*domain.AuthFactorPassword](attempt, domain.AuthCheckTypePassword)
		assert.False(t, ok)
		assert.Nil(t, factor)
	})
}

func TestAuthAttempt_IsExpiredAndExpiresAt(t *testing.T) {
	now := time.Now()
	ttl := 10 * time.Minute

	tests := []struct {
		name        string
		createdAt   time.Time
		ttl         *time.Duration
		currentTime time.Time
		wantExpired bool
		wantExpires time.Time
	}{
		{
			name:        "zero CreatedAt is not expired",
			createdAt:   time.Time{},
			ttl:         &ttl,
			currentTime: now,
			wantExpired: false,
			wantExpires: time.Time{},
		},
		{
			name:        "nil TTL is not expired",
			createdAt:   now,
			ttl:         nil,
			currentTime: now,
			wantExpired: false,
			wantExpires: time.Time{},
		},
		{
			name:        "not expired before TTL",
			createdAt:   now,
			ttl:         &ttl,
			currentTime: now.Add(5 * time.Minute),
			wantExpired: false,
			wantExpires: now.Add(ttl),
		},
		{
			name:        "expired after TTL",
			createdAt:   now,
			ttl:         &ttl,
			currentTime: now.Add(11 * time.Minute),
			wantExpired: true,
			wantExpires: now.Add(ttl),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attempt := &domain.AuthAttempt{
				CreatedAt:  tt.createdAt,
				TimeToLive: tt.ttl,
			}
			assert.Equal(t, tt.wantExpires, attempt.ExpiresAt())
			// Mocking time in Go for direct test of IsExpired could be done by using a helper or checking how IsExpired behaves.
			// IsExpired() internally calls time.Now().After(a.ExpiresAt())
			// Since we cannot easily stub time.Now() unless we introduce a clock, we can test using extreme times (very old/future CreatedAt).
			if tt.createdAt.IsZero() || tt.ttl == nil {
				assert.False(t, attempt.IsExpired())
			} else {
				if tt.wantExpired {
					attempt.CreatedAt = time.Now().Add(-2 * ttl)
					assert.True(t, attempt.IsExpired())
				} else {
					attempt.CreatedAt = time.Now()
					assert.False(t, attempt.IsExpired())
				}
			}
		})
	}
}

func TestAuthAttempt_IsCompleted(t *testing.T) {
	required := []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}

	tests := []struct {
		name          string
		checks        []domain.AuthCheck
		wantCompleted bool
	}{
		{
			name:          "no checks is not completed",
			checks:        nil,
			wantCompleted: false,
		},
		{
			name: "challenges instead of factors is not completed",
			checks: []domain.AuthCheck{
				domain.SetAuthChallengeUser("ch-1", time.Now(), time.Time{}, 0),
				domain.SetAuthChallengePassword("ch-2", time.Now(), time.Time{}, 0),
			},
			wantCompleted: false,
		},
		{
			name: "partial factors is not completed",
			checks: []domain.AuthCheck{
				domain.SetAuthFactorUser(time.Now()),
			},
			wantCompleted: false,
		},
		{
			name: "all factors is completed",
			checks: []domain.AuthCheck{
				domain.SetAuthFactorUser(time.Now()),
				domain.SetAuthFactorPassword(time.Now()),
			},
			wantCompleted: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attempt := &domain.AuthAttempt{
				RequiredChecks: required,
				Checks:         tt.checks,
			}
			assert.Equal(t, tt.wantCompleted, attempt.IsCompleted())
		})
	}
}

func TestAuthAttempt_IsHandedOff(t *testing.T) {
	t.Run("nil handoff token", func(t *testing.T) {
		attempt := &domain.AuthAttempt{}
		assert.False(t, attempt.IsHandedOff())
	})

	t.Run("non-nil handoff token", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
			Checks:         []domain.AuthCheck{domain.SetAuthFactorUser(time.Now())},
		}
		err := attempt.PrepareHandoff()
		require.NoError(t, err)
		assert.True(t, attempt.IsHandedOff())
	})
}

func TestAuthAttempt_Finders(t *testing.T) {
	userFactor := domain.SetAuthFactorUser(time.Now())
	userChallenge := domain.SetAuthChallengeUser("ch-user", time.Now(), time.Time{}, 0)
	passwordChallenge := domain.SetAuthChallengePassword("ch-pass", time.Now(), time.Time{}, 0)

	attempt := &domain.AuthAttempt{
		Checks: []domain.AuthCheck{userFactor, userChallenge, passwordChallenge},
	}

	t.Run("FactorByType", func(t *testing.T) {
		factor, ok := attempt.FactorByType(domain.AuthCheckTypeUser)
		assert.True(t, ok)
		assert.Equal(t, userFactor, factor)

		_, ok = attempt.FactorByType(domain.AuthCheckTypePassword)
		assert.False(t, ok)
	})

	t.Run("ChallengeByType", func(t *testing.T) {
		challenge, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
		assert.True(t, ok)
		assert.Equal(t, userChallenge, challenge)

		challenge2, ok := attempt.ChallengeByType(domain.AuthCheckTypePassword)
		assert.True(t, ok)
		assert.Equal(t, passwordChallenge, challenge2)
	})

	t.Run("ChallengeByID", func(t *testing.T) {
		challenge, ok := attempt.ChallengeByID("ch-user")
		assert.True(t, ok)
		assert.Equal(t, userChallenge, challenge)

		_, ok = attempt.ChallengeByID("ch-nonexistent")
		assert.False(t, ok)
	})
}

func TestAuthAttempt_PrepareChallenge(t *testing.T) {
	ttl := time.Minute

	t.Run("succeeds when active", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
		}
		err := attempt.PrepareChallenge(domain.AuthCheckTypeUser)
		assert.NoError(t, err)
	})

	t.Run("fails when expired", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now().Add(-2 * ttl),
			TimeToLive: &ttl,
		}
		err := attempt.PrepareChallenge(domain.AuthCheckTypeUser)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidState())
	})

	t.Run("fails when already handed off", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
		}
		attempt.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser}
		attempt.Checks = []domain.AuthCheck{domain.SetAuthFactorUser(time.Now())}
		err := attempt.PrepareHandoff()
		require.NoError(t, err)

		err = attempt.PrepareChallenge(domain.AuthCheckTypeUser)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
	})
}

func TestAuthAttempt_PrepareUserChallenge(t *testing.T) {
	ttl := time.Minute

	t.Run("fails if base challenge preparation fails", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now().Add(-2 * ttl),
			TimeToLive: &ttl,
		}
		err := attempt.PrepareUserChallenge()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidState())
	})

	t.Run("fails if session ID is set and user factor exists", func(t *testing.T) {
		sess := "sess-1"
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			SessionID:  &sess,
			Checks:     []domain.AuthCheck{domain.SetAuthFactorUser(time.Now())},
		}
		err := attempt.PrepareUserChallenge()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
		assert.Contains(t, err.Error(), "The user was already authenticated")
	})

	t.Run("succeeds if session ID is set and user factor does not exist", func(t *testing.T) {
		sess := "sess-1"
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			SessionID:  &sess,
		}
		err := attempt.PrepareUserChallenge()
		assert.NoError(t, err)
	})

	t.Run("fails if session ID is not set but other factor exists", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{domain.SetAuthFactorPassword(time.Now())},
		}
		err := attempt.PrepareUserChallenge()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
		assert.Contains(t, err.Error(), "The user must not be changed after it was authenticated")
	})

	t.Run("succeeds if session ID is not set and no other factors exist", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
		}
		err := attempt.PrepareUserChallenge()
		assert.NoError(t, err)
	})
}

func TestAuthAttempt_PreparePasswordChallenge(t *testing.T) {
	ttl := time.Minute

	t.Run("fails if base challenge preparation fails", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now().Add(-2 * ttl),
			TimeToLive: &ttl,
		}
		err := attempt.PreparePasswordChallenge()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidState())
	})

	t.Run("fails if user factor does not exist", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
		}
		err := attempt.PreparePasswordChallenge()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
		assert.Contains(t, err.Error(), "password challenge requires user verification first")
	})

	t.Run("succeeds if user factor exists", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{domain.SetAuthFactorUser(time.Now())},
		}
		err := attempt.PreparePasswordChallenge()
		assert.NoError(t, err)
	})
}

func TestAuthAttempt_SetChallenge(t *testing.T) {
	attempt := &domain.AuthAttempt{}

	t.Run("SetUserChallenge", func(t *testing.T) {
		challenge := attempt.SetUserChallenge()
		assert.NotNil(t, challenge)
		assert.Equal(t, domain.AuthCheckTypeUser, challenge.Type())
		require.Len(t, attempt.Checks, 1)
		assert.Equal(t, challenge, attempt.Checks[0])
	})

	t.Run("SetPasswordChallenge", func(t *testing.T) {
		challenge := attempt.SetPasswordChallenge()
		assert.NotNil(t, challenge)
		assert.Equal(t, domain.AuthCheckTypePassword, challenge.Type())
		require.Len(t, attempt.Checks, 2)
		assert.Equal(t, challenge, attempt.Checks[1])
	})
}

func TestAuthAttempt_PrepareVerification(t *testing.T) {
	ttl := time.Minute

	t.Run("fails when expired", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now().Add(-2 * ttl),
			TimeToLive: &ttl,
		}
		_, err := attempt.PrepareVerification("ch-1", domain.AuthCheckTypeUser)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidState())
	})

	t.Run("fails when handed off", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:      time.Now(),
			TimeToLive:     &ttl,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
			Checks:         []domain.AuthCheck{domain.SetAuthFactorUser(time.Now())},
		}
		err := attempt.PrepareHandoff()
		require.NoError(t, err)

		_, err = attempt.PrepareVerification("ch-1", domain.AuthCheckTypeUser)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
	})

	t.Run("fails when challenge ID not found", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
		}
		_, err := attempt.PrepareVerification("ch-nonexistent", domain.AuthCheckTypeUser)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("fails when proof type mismatch", func(t *testing.T) {
		challenge := domain.SetAuthChallengeUser("ch-1", time.Now(), time.Time{}, 0)
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{challenge},
		}
		_, err := attempt.PrepareVerification("ch-1", domain.AuthCheckTypePassword)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})

	t.Run("succeeds when validation passes", func(t *testing.T) {
		challenge := domain.SetAuthChallengeUser("ch-1", time.Now(), time.Time{}, 0)
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{challenge},
		}
		res, err := attempt.PrepareVerification("ch-1", domain.AuthCheckTypeUser)
		assert.NoError(t, err)
		assert.Equal(t, challenge, res)
	})
}

func TestAuthAttempt_PrepareUserVerification(t *testing.T) {
	ttl := time.Minute
	challenge := domain.SetAuthChallengeUser("ch-1", time.Now(), time.Time{}, 0)

	t.Run("fails if other factors verified", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{challenge, domain.SetAuthFactorPassword(time.Now())},
		}
		_, err := attempt.PrepareUserVerification("ch-1")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
		assert.Contains(t, err.Error(), "The user must not be changed after it was authenticated")
	})

	t.Run("succeeds when conditions are met", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{challenge},
		}
		res, err := attempt.PrepareUserVerification("ch-1")
		assert.NoError(t, err)
		assert.Equal(t, challenge, res)
	})
}

func TestAuthAttempt_PreparePasswordVerification(t *testing.T) {
	ttl := time.Minute
	challenge := domain.SetAuthChallengePassword("ch-pass", time.Now(), time.Time{}, 0)

	t.Run("fails if user factor does not exist", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{challenge},
		}
		_, _, err := attempt.PreparePasswordVerification("ch-pass")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})

	t.Run("succeeds and returns challenge and user factor", func(t *testing.T) {
		userFactor := domain.SetAuthFactorUser(time.Now())
		userFactor.UserID = "user-123"
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now(),
			TimeToLive: &ttl,
			Checks:     []domain.AuthCheck{challenge, userFactor},
		}
		resChallenge, resUserFactor, err := attempt.PreparePasswordVerification("ch-pass")
		assert.NoError(t, err)
		assert.Equal(t, challenge, resChallenge)
		assert.Equal(t, userFactor, resUserFactor)
	})
}

func TestAuthAttempt_SetFactors(t *testing.T) {
	attempt := &domain.AuthAttempt{}

	t.Run("SetUserFactor", func(t *testing.T) {
		u := &domain.User{ID: "user-123"}
		factor := attempt.SetUserFactor(u)
		assert.NotNil(t, factor)
		assert.Equal(t, domain.AuthCheckTypeUser, factor.Type())
		assert.Equal(t, "user-123", factor.UserID)
		require.Len(t, attempt.Checks, 1)
		assert.Equal(t, factor, attempt.Checks[0])
	})

	t.Run("SetPasswordFactor", func(t *testing.T) {
		factor := attempt.SetPasswordFactor()
		assert.NotNil(t, factor)
		assert.Equal(t, domain.AuthCheckTypePassword, factor.Type())
		require.Len(t, attempt.Checks, 2)
		assert.Equal(t, factor, attempt.Checks[1])
	})
}

func TestAuthAttempt_PrepareHandoff(t *testing.T) {
	ttl := time.Minute

	t.Run("fails when expired", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:  time.Now().Add(-2 * ttl),
			TimeToLive: &ttl,
		}
		err := attempt.PrepareHandoff()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidState())
	})

	t.Run("fails when not completed", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:      time.Now(),
			TimeToLive:     &ttl,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		}
		err := attempt.PrepareHandoff()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptNotCompleted())
	})

	t.Run("fails when already handed off", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:      time.Now(),
			TimeToLive:     &ttl,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
			Checks:         []domain.AuthCheck{domain.SetAuthFactorUser(time.Now())},
		}
		err := attempt.PrepareHandoff()
		require.NoError(t, err)

		err = attempt.PrepareHandoff()
		assert.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
	})

	t.Run("succeeds and sets handoff token when valid", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			CreatedAt:      time.Now(),
			TimeToLive:     &ttl,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
			Checks:         []domain.AuthCheck{domain.SetAuthFactorUser(time.Now())},
		}
		err := attempt.PrepareHandoff()
		assert.NoError(t, err)
		assert.NotNil(t, attempt.HandoffToken)
		assert.NotEmpty(t, attempt.HandoffToken.Plain())
	})
}

func TestAuthAttempt_SetCheck(t *testing.T) {
	t.Run("adds check when type not present", func(t *testing.T) {
		attempt := &domain.AuthAttempt{}
		userChallenge := domain.SetAuthChallengeUser("ch-user", time.Now(), time.Time{}, 0)
		attempt.SetCheck(userChallenge)
		assert.Len(t, attempt.Checks, 1)
		assert.Equal(t, userChallenge, attempt.Checks[0])
	})

	t.Run("overwrites existing challenge of same type but keeps factor", func(t *testing.T) {
		userChallenge1 := domain.SetAuthChallengeUser("ch-user-1", time.Now(), time.Time{}, 0)
		userFactor := domain.SetAuthFactorUser(time.Now())
		attempt := &domain.AuthAttempt{
			Checks: []domain.AuthCheck{userChallenge1, userFactor},
		}

		userChallenge2 := domain.SetAuthChallengeUser("ch-user-2", time.Now(), time.Time{}, 0)
		attempt.SetCheck(userChallenge2)

		assert.Len(t, attempt.Checks, 2)
		// Check that the challenge was overwritten, but factor is still there.
		assert.Contains(t, attempt.Checks, userChallenge2)
		assert.Contains(t, attempt.Checks, userFactor)
		assert.NotContains(t, attempt.Checks, userChallenge1)
	})

	t.Run("overwrites existing factor and removes challenges of same type", func(t *testing.T) {
		userFactor1 := domain.SetAuthFactorUser(time.Now())
		userChallenge := domain.SetAuthChallengeUser("ch-user", time.Now(), time.Time{}, 0)
		attempt := &domain.AuthAttempt{
			Checks: []domain.AuthCheck{userFactor1, userChallenge},
		}

		userFactor2 := domain.SetAuthFactorUser(time.Now().Add(time.Second))
		attempt.SetCheck(userFactor2)

		assert.Len(t, attempt.Checks, 1)
		assert.Equal(t, userFactor2, attempt.Checks[0])
	})
}
