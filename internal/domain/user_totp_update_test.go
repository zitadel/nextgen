package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestNewUserTOTPUpdates_failedAttempts(t *testing.T) {
	t.Parallel()

	got := domain.NewUserTOTPUpdates(
		domain.WithUserTOTPIncrementFailedAttempts(),
		domain.WithUserTOTPIncrementFailedAttempts(),
	)
	assert.Equal(t, int16(2), got.FailedAttemptsDelta)
	assert.False(t, got.ResetFailedAttempts)

	got = domain.NewUserTOTPUpdates(
		domain.WithUserTOTPIncrementFailedAttempts(),
		domain.WithUserTOTPResetFailedAttempts(),
	)
	assert.Zero(t, got.FailedAttemptsDelta)
	assert.True(t, got.ResetFailedAttempts)

	got = domain.NewUserTOTPUpdates(
		domain.WithUserTOTPResetFailedAttempts(),
		domain.WithUserTOTPIncrementFailedAttempts(),
	)
	assert.Equal(t, int16(1), got.FailedAttemptsDelta)
	assert.False(t, got.ResetFailedAttempts)
}

func TestNewUserTOTPUpdates_lastWinsSets(t *testing.T) {
	t.Parallel()

	first := time.Unix(1, 0).UTC()
	second := time.Unix(2, 0).UTC()
	got := domain.NewUserTOTPUpdates(
		domain.WithUserTOTPSecret([]byte("a")),
		domain.WithUserTOTPSecret([]byte("b")),
		domain.WithUserTOTPVerifiedAt(first),
		domain.WithUserTOTPVerifiedAt(second),
	)
	require.NotNil(t, got.Secret)
	assert.Equal(t, []byte("b"), *got.Secret)
	require.NotNil(t, got.VerifiedAt)
	assert.Equal(t, second, *got.VerifiedAt)
	assert.False(t, got.Empty())
}

func TestNewUserTOTPUpdates_empty(t *testing.T) {
	t.Parallel()
	assert.True(t, domain.NewUserTOTPUpdates().Empty())
}
