package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestRequireNonEmptyRecoveryCodes(t *testing.T) {
	assert.ErrorIs(t, domain.RequireNonEmptyRecoveryCodes(nil), domain.ErrEmptyRecoveryCodes)
	assert.ErrorIs(t, domain.RequireNonEmptyRecoveryCodes([]string{}), domain.ErrEmptyRecoveryCodes)
	assert.NoError(t, domain.RequireNonEmptyRecoveryCodes([]string{"a"}))
}

func TestNewUserRecoveryCodesUpdates(t *testing.T) {
	assert.True(t, domain.NewUserRecoveryCodesUpdates().Empty())
	assert.True(t, domain.NewUserRecoveryCodesUpdates(nil).Empty())

	now := time.Now().UTC()
	applied := domain.NewUserRecoveryCodesUpdates(
		domain.WithUserRecoveryCodesCodes([]string{"a", "b"}),
		domain.WithUserRecoveryCodesLastSuccessfulCheck(&now),
		domain.WithUserRecoveryCodesLastSuccessfulCheck(nil),
		domain.WithUserRecoveryCodesIncrementFailedAttempts(),
		domain.WithUserRecoveryCodesResetFailedAttempts(),
	)
	require.False(t, applied.Empty())
	ops := applied.Ops()
	require.Len(t, ops, 5)

	assert.Equal(t, domain.UserRecoveryCodesOpSetCodes, ops[0].Kind)
	assert.Equal(t, []string{"a", "b"}, ops[0].Codes)

	assert.Equal(t, domain.UserRecoveryCodesOpSetLastSuccessfulCheck, ops[1].Kind)
	require.NotNil(t, ops[1].Time)
	assert.Equal(t, now, *ops[1].Time)

	assert.Equal(t, domain.UserRecoveryCodesOpSetLastSuccessfulCheck, ops[2].Kind)
	assert.Nil(t, ops[2].Time)

	assert.Equal(t, domain.UserRecoveryCodesOpIncrementFailedAttempts, ops[3].Kind)
	assert.Equal(t, domain.UserRecoveryCodesOpResetFailedAttempts, ops[4].Kind)
}

func TestWithUserRecoveryCodesCodesCopiesSlice(t *testing.T) {
	src := []string{"one"}
	applied := domain.NewUserRecoveryCodesUpdates(domain.WithUserRecoveryCodesCodes(src))
	src[0] = "mutated"
	assert.Equal(t, []string{"one"}, applied.Ops()[0].Codes)
}
