package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestUserRecoveryCodesUpdate_implementsInterface(t *testing.T) {
	t.Parallel()

	var _ domain.UserRecoveryCodesUpdate = domain.NewUserRecoveryCodesCodesUpdate([]string{"a"})
	var _ domain.UserRecoveryCodesUpdate = &domain.UserRecoveryCodesLastSuccessfulCheckUpdate{}
	var _ domain.UserRecoveryCodesUpdate = &domain.UserRecoveryCodesIncrementFailedAttemptsUpdate{Delta: 1}
	var _ domain.UserRecoveryCodesUpdate = &domain.UserRecoveryCodesResetFailedAttemptsUpdate{}
}

func TestNewUserRecoveryCodesCodesUpdate_copies(t *testing.T) {
	t.Parallel()

	src := []string{"one"}
	got := domain.NewUserRecoveryCodesCodesUpdate(src)
	require.NotNil(t, got)
	assert.Equal(t, []string{"one"}, got.Codes)
	src[0] = "mutated"
	assert.Equal(t, []string{"one"}, got.Codes)
}

func TestRequireNonEmptyRecoveryCodes(t *testing.T) {
	t.Parallel()
	assert.ErrorIs(t, domain.RequireNonEmptyRecoveryCodes(nil), domain.ErrEmptyRecoveryCodes)
	assert.ErrorIs(t, domain.RequireNonEmptyRecoveryCodes([]string{}), domain.ErrEmptyRecoveryCodes)
	assert.NoError(t, domain.RequireNonEmptyRecoveryCodes([]string{"a"}))
}

func TestUserRecoveryCodesLastSuccessfulCheckUpdate_nilClears(t *testing.T) {
	t.Parallel()
	now := time.Now()
	u := &domain.UserRecoveryCodesLastSuccessfulCheckUpdate{LastSuccessfulCheck: &now}
	assert.NotNil(t, u.LastSuccessfulCheck)
	u = &domain.UserRecoveryCodesLastSuccessfulCheckUpdate{LastSuccessfulCheck: nil}
	assert.Nil(t, u.LastSuccessfulCheck)
}
