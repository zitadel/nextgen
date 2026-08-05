package api

import (
	"testing"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// The contract only knows active and deactivated, so every other domain status
// has to collapse onto one of them.
func TestTeamStatus(t *testing.T) {
	tests := []struct {
		status domain.TeamStatus
		want   api.TeamStatus
	}{
		{domain.TeamStatusActive, api.TeamStatusActive},
		{domain.TeamStatusDeactivated, api.TeamStatusDeactivated},
		{domain.TeamStatusPendingPurge, api.TeamStatusDeactivated},
	}
	for _, tt := range tests {
		t.Run(tt.status.String(), func(t *testing.T) {
			if got := teamStatus(tt.status); got != tt.want {
				t.Fatalf("teamStatus(%q) = %q, want %q", tt.status, got, tt.want)
			}
		})
	}
}
