package api

import (
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

// Every public project error code must map to its documented HTTP status, so a
// handler returning one of these sentinels produces the status the OpenAPI
// contract advertises rather than falling through to 500.
func TestProjectErrorResponse(t *testing.T) {
	tests := []struct {
		name string
		err  domain.Error
		want int
	}{
		{"not_found", domain.ErrProjectNotFound(), http.StatusNotFound},
		{"permission_denied", domain.ErrProjectPermissionDenied(), http.StatusForbidden},
		{"name_invalid", domain.ErrProjectNameInvalid(), http.StatusBadRequest},
		{"missing_id", domain.ErrProjectMissingID(), http.StatusBadRequest},
		{"already_claimed", domain.ErrProjectAlreadyClaimed(), http.StatusConflict},
		{"claim_expired", domain.ErrProjectClaimExpired(), http.StatusGone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := projectErrorResponse(tt.err); got.StatusCode != tt.want {
				t.Fatalf("projectErrorResponse(%q) status = %d, want %d", tt.err.Code, got.StatusCode, tt.want)
			}
		})
	}
}
