package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestUserPasskeyUpdate_implementsInterface(t *testing.T) {
	t.Parallel()

	var _ domain.UserPasskeyUpdate = &domain.UserPasskeyAttestationTypeUpdate{AttestationType: "none"}
	var _ domain.UserPasskeyUpdate = domain.NewUserPasskeyTransportsUpdate([]string{"usb"})
	var _ domain.UserPasskeyUpdate = &domain.UserPasskeySignCountUpdate{SignCount: 1}
	var _ domain.UserPasskeyUpdate = &domain.UserPasskeyIncrementSignCountUpdate{Delta: 1}
	var _ domain.UserPasskeyUpdate = &domain.UserPasskeyBackupEligibleUpdate{}
	var _ domain.UserPasskeyUpdate = &domain.UserPasskeyBackupStateUpdate{}
	var _ domain.UserPasskeyUpdate = &domain.UserPasskeyVerifiedAtUpdate{VerifiedAt: time.Now()}
	var _ domain.UserPasskeyUpdate = &domain.UserPasskeyLastUsedAtUpdate{LastUsedAt: time.Now()}
}

func TestNewUserPasskeyTransportsUpdate(t *testing.T) {
	t.Parallel()

	empty := domain.NewUserPasskeyTransportsUpdate(nil)
	require.NotNil(t, empty)
	assert.Equal(t, []string{}, empty.Transports)

	src := []string{"usb"}
	got := domain.NewUserPasskeyTransportsUpdate(src)
	src[0] = "nfc"
	assert.Equal(t, []string{"usb"}, got.Transports)
}
