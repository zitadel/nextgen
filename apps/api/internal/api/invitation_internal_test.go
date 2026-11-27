package api

import (
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestInvitationErrorResponse(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		err      domain.Error
		wantCode int
		wantBody string
	}{
		{"invalid", domain.ErrInvitationInvalid(), http.StatusBadRequest, domain.ErrInvitationInvalid().Code},
		{"not_found", domain.ErrInvitationNotFound(), http.StatusNotFound, domain.ErrInvitationNotFound().Code},
		{"not_pending_is_opaque_not_found", domain.ErrInvitationNotPending(), http.StatusNotFound, domain.ErrInvitationNotFound().Code},
		{"permission_denied", domain.ErrInvitationPermissionDenied(), http.StatusForbidden, domain.ErrInvitationPermissionDenied().Code},
		{"self_accept", domain.ErrInvitationSelfAccept(), http.StatusForbidden, domain.ErrInvitationSelfAccept().Code},
		{"project_unclaimed", domain.ErrInvitationProjectUnclaimed(), http.StatusConflict, domain.ErrInvitationProjectUnclaimed().Code},
		{"pending_limit", domain.ErrInvitationPendingLimit(), http.StatusConflict, domain.ErrInvitationPendingLimit().Code},
		{"platform_required", domain.ErrInvitationPlatformRequired(), http.StatusConflict, domain.ErrInvitationPlatformRequired().Code},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := invitationErrorResponse(tt.err)
			if got.StatusCode != tt.wantCode {
				t.Fatalf("status = %d, want %d", got.StatusCode, tt.wantCode)
			}
			if string(got.Response.Code) != tt.wantBody {
				t.Fatalf("code = %q, want %q", got.Response.Code, tt.wantBody)
			}
		})
	}
}
