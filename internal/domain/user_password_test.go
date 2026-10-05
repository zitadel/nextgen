package domain

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestUserPasswordFailures_NextRetryTime(t *testing.T) {
	last := time.Now().Add(-time.Second)
	tests := []struct {
		name     string
		failures UserPasswordFailures
		want     time.Duration // after last, 0 for no restriction
	}{
		{name: "no failures", failures: UserPasswordFailures{}, want: 0},
		{name: "free failures", failures: UserPasswordFailures{Count: UserPasswordFreeFailures, LastFailedAt: last}, want: 0},
		{name: "first restricted failure", failures: UserPasswordFailures{Count: UserPasswordFreeFailures + 1, LastFailedAt: last}, want: UserPasswordBackoffBase},
		{name: "grows per failure", failures: UserPasswordFailures{Count: UserPasswordFreeFailures + 3, LastFailedAt: last}, want: 3 * UserPasswordBackoffBase},
		{name: "capped", failures: UserPasswordFailures{Count: 1000, LastFailedAt: last}, want: UserPasswordBackoffMax},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.failures.NextRetryTime()
			if tt.want == 0 {
				assert.True(t, got.IsZero(), "got %v", got)
				return
			}
			assert.Equal(t, last.Add(tt.want), got)
		})
	}
}

func TestUserPasswordFailuresSince(t *testing.T) {
	now := time.Now()
	assert.Equal(t, now.Add(-UserPasswordFailureWindow), UserPasswordFailuresSince(now))
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
	pw := &UserPassword{EncodedHash: "encoded"}

	t.Run("correct password", func(t *testing.T) {
		failures := UserPasswordFailures{Count: 3, LastFailedAt: time.Now()}
		assert.NoError(t, pw.VerifyRateLimited("secret", &fakeVerifier{}, failures))
	})

	t.Run("wrong password", func(t *testing.T) {
		err := pw.VerifyRateLimited("wrong", &fakeVerifier{err: errors.New("mismatch")}, UserPasswordFailures{})
		assert.ErrorIs(t, err, ErrUserPasswordInvalid())
	})

	t.Run("restricted password is not checked", func(t *testing.T) {
		failures := UserPasswordFailures{Count: UserPasswordFreeFailures + 1, LastFailedAt: time.Now()}
		verifier := &fakeVerifier{}
		err := pw.VerifyRateLimited("secret", verifier, failures)
		assert.ErrorIs(t, err, ErrUserPasswordRateLimited())
		assert.False(t, verifier.called)
	})

	t.Run("restriction lifts after the wait", func(t *testing.T) {
		failures := UserPasswordFailures{
			Count:        UserPasswordFreeFailures + 1,
			LastFailedAt: time.Now().Add(-UserPasswordBackoffBase - time.Second),
		}
		verifier := &fakeVerifier{}
		assert.NoError(t, pw.VerifyRateLimited("secret", verifier, failures))
		assert.True(t, verifier.called)
	})
}
