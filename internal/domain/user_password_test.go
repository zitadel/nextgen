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

func TestUserPassword_Verify(t *testing.T) {
	pw := &UserPassword{EncodedHash: "encoded"}
	assert.NoError(t, pw.Verify("secret", &fakeVerifier{}))
	assert.ErrorIs(t, pw.Verify("wrong", &fakeVerifier{err: errors.New("mismatch")}), ErrUserPasswordInvalid())
}

func TestUserPasswordFailures_CheckRateLimit(t *testing.T) {
	now := time.Now()
	assert.NoError(t, UserPasswordFailures{}.CheckRateLimit())
	assert.NoError(t, UserPasswordFailures{Count: UserPasswordFreeFailures, LastFailedAt: now}.CheckRateLimit(),
		"the free failures hold nothing back")

	restricted := func(lastFailedAt time.Time) UserPasswordFailures {
		return UserPasswordFailures{Count: UserPasswordFreeFailures + 1, LastFailedAt: lastFailedAt}
	}
	assert.ErrorIs(t, restricted(now).CheckRateLimit(), ErrUserPasswordRateLimited())
	assert.ErrorIs(t, restricted(now.Add(-UserPasswordBackoffBase+10*time.Second)).CheckRateLimit(), ErrUserPasswordRateLimited(),
		"still within the wait")
	assert.NoError(t, restricted(now.Add(-UserPasswordBackoffBase)).CheckRateLimit(), "the restriction lifts after the wait")
}
