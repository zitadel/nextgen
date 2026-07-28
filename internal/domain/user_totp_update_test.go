package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestUserTOTPUpdate_implementsInterface(t *testing.T) {
	t.Parallel()

	var _ domain.UserTOTPUpdate = domain.NewUserTOTPSecretUpdate([]byte("x"))
	var _ domain.UserTOTPUpdate = &domain.UserTOTPVerifiedAtUpdate{VerifiedAt: time.Now()}
	var _ domain.UserTOTPUpdate = &domain.UserTOTPLastSuccessfulCheckUpdate{LastSuccessfulCheck: time.Now()}
	var _ domain.UserTOTPUpdate = &domain.UserTOTPIncrementFailedAttemptsUpdate{Delta: 1}
	var _ domain.UserTOTPUpdate = &domain.UserTOTPResetFailedAttemptsUpdate{}
}

func TestNewUserTOTPSecretUpdate_copies(t *testing.T) {
	t.Parallel()

	src := []byte("secret")
	got := domain.NewUserTOTPSecretUpdate(src)
	require.NotNil(t, got)
	assert.Equal(t, []byte("secret"), got.Secret)
	src[0] ^= 0xff
	assert.Equal(t, []byte("secret"), got.Secret)
}
