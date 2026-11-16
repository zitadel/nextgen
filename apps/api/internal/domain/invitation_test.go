package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestInvitation_StatusAt(t *testing.T) {
	t.Parallel()
	expiresAt := time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		stored domain.InvitationStatus
		now    time.Time
		want   domain.InvitationStatus
	}{
		{"pending_before_expiry", domain.InvitationStatusPending, expiresAt.Add(-time.Nanosecond), domain.InvitationStatusPending},
		{"pending_at_expiry", domain.InvitationStatusPending, expiresAt, domain.InvitationStatusExpired},
		{"accepted_stays_accepted", domain.InvitationStatusAccepted, expiresAt.Add(time.Hour), domain.InvitationStatusAccepted},
		{"rejected_stays_rejected", domain.InvitationStatusRejected, expiresAt.Add(time.Hour), domain.InvitationStatusRejected},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			invitation := &domain.Invitation{Status: tt.stored, ExpiresAt: expiresAt}
			assert.Equal(t, tt.want, invitation.StatusAt(tt.now))
		})
	}
}
