package domain

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestUserPassword_NextRetryTime(t *testing.T) {
	lastFailed := time.Now().Add(-time.Second)
	tests := []struct {
		name     string
		failures int
		last     time.Time
		want     time.Duration // after lastFailed, 0 for no restriction
	}{
		{name: "no failures", failures: 0, want: 0},
		{name: "free failures", failures: UserPasswordFreeFailures, last: lastFailed, want: 0},
		{name: "first restricted failure", failures: UserPasswordFreeFailures + 1, last: lastFailed, want: UserPasswordBackoffBase},
		{name: "grows per failure", failures: UserPasswordFreeFailures + 3, last: lastFailed, want: 3 * UserPasswordBackoffBase},
		{name: "capped", failures: 1000, last: lastFailed, want: UserPasswordBackoffMax},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pw := &UserPassword{FailedAttemptCount: tt.failures, LastFailedAt: tt.last}
			got := pw.NextRetryTime()
			if tt.want == 0 {
				assert.True(t, got.IsZero(), "got %v", got)
				return
			}
			assert.Equal(t, tt.last.Add(tt.want), got)
		})
	}
}

type fakeVerifier struct {
	err    error
	called bool
}

func (f *fakeVerifier) VerifyHash(string, string) error {
	f.called = true
	return f.err
}

func TestUserPassword_VerifyRateLimited(t *testing.T) {
	t.Run("correct password clears failures", func(t *testing.T) {
		pw := &UserPassword{FailedAttemptCount: 3, LastFailedAt: time.Now()}
		assert.NoError(t, pw.VerifyRateLimited("secret", &fakeVerifier{}))
		assert.Zero(t, pw.FailedAttemptCount)
		assert.True(t, pw.LastFailedAt.IsZero())
	})

	t.Run("wrong password counts a failure", func(t *testing.T) {
		pw := &UserPassword{FailedAttemptCount: 2, LastFailedAt: time.Now().Add(-time.Minute)}
		err := pw.VerifyRateLimited("wrong", &fakeVerifier{err: errors.New("mismatch")})
		assert.ErrorIs(t, err, ErrUserPasswordInvalid())
		assert.Equal(t, 3, pw.FailedAttemptCount)
		assert.WithinDuration(t, time.Now(), pw.LastFailedAt, time.Second)
	})

	t.Run("restricted password is not checked", func(t *testing.T) {
		last := time.Now()
		pw := &UserPassword{FailedAttemptCount: UserPasswordFreeFailures + 1, LastFailedAt: last}
		verifier := &fakeVerifier{}
		err := pw.VerifyRateLimited("secret", verifier)
		assert.ErrorIs(t, err, ErrUserPasswordRateLimited())
		assert.False(t, verifier.called)
		assert.Equal(t, UserPasswordFreeFailures+1, pw.FailedAttemptCount, "a refused check is not counted")
		assert.Equal(t, last, pw.LastFailedAt)
	})

	t.Run("restriction lifts after the wait", func(t *testing.T) {
		pw := &UserPassword{
			FailedAttemptCount: UserPasswordFreeFailures + 1,
			LastFailedAt:       time.Now().Add(-UserPasswordBackoffBase - time.Second),
		}
		assert.NoError(t, pw.VerifyRateLimited("secret", &fakeVerifier{}))
	})
}

func TestUserPassword_VerifyRateLimited_Decay(t *testing.T) {
	t.Run("fully decayed failures allow a check", func(t *testing.T) {
		pw := &UserPassword{
			FailedAttemptCount: UserPasswordFreeFailures + 1,
			LastFailedAt:       time.Now().Add(-2 * UserPasswordFailureDecay),
		}
		assert.False(t, pw.NextRetryTime().After(time.Now()), "got %v", pw.NextRetryTime())
		verifier := &fakeVerifier{}
		assert.NoError(t, pw.VerifyRateLimited("secret", verifier))
		assert.True(t, verifier.called)
	})

	t.Run("a wrong password after a quiet period starts counting again", func(t *testing.T) {
		pw := &UserPassword{
			FailedAttemptCount: 1000,
			LastFailedAt:       time.Now().Add(-UserPasswordFailureDecay - time.Second),
		}
		err := pw.VerifyRateLimited("wrong", &fakeVerifier{err: errors.New("mismatch")})
		assert.ErrorIs(t, err, ErrUserPasswordInvalid())
		assert.Equal(t, 1, pw.FailedAttemptCount, "old failures do not carry over")
		assert.True(t, pw.NextRetryTime().IsZero(), "one failure is within the free ones")
	})

	t.Run("a wrong password within the decay period keeps counting", func(t *testing.T) {
		pw := &UserPassword{
			FailedAttemptCount: 2,
			LastFailedAt:       time.Now().Add(-UserPasswordFailureDecay + time.Minute),
		}
		err := pw.VerifyRateLimited("wrong", &fakeVerifier{err: errors.New("mismatch")})
		assert.ErrorIs(t, err, ErrUserPasswordInvalid())
		assert.Equal(t, 3, pw.FailedAttemptCount)
	})
}
