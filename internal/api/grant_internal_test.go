package api

import (
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

// Every public grant error code must map to its documented HTTP status, so a
// handler returning one of these sentinels produces the status the OpenAPI
// contract advertises rather than falling through to 500.
func TestGrantErrorResponse(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  domain.Error
		want int
	}{
		{"invalid", domain.ErrGrantInvalid(), http.StatusBadRequest},
		{"not_found", domain.ErrGrantNotFound(), http.StatusNotFound},
		{"principal_not_found", domain.ErrGrantPrincipalNotFound(), http.StatusNotFound},
		{"already_exists", domain.ErrGrantAlreadyExists(), http.StatusConflict},
		{"permission_denied", domain.ErrGrantPermissionDenied(), http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := grantErrorResponse(tt.err); got.StatusCode != tt.want {
				t.Fatalf("grantErrorResponse(%q) status = %d, want %d", tt.err.Code, got.StatusCode, tt.want)
			}
		})
	}
}
