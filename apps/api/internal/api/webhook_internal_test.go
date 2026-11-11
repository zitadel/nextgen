package api

import (
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestWebhookErrorResponse(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		err      domain.Error
		wantCode int
	}{
		{"invalid", domain.ErrWebhookInvalid(), http.StatusBadRequest},
		{"not_found", domain.ErrWebhookNotFound(), http.StatusNotFound},
		{"permission_denied", domain.ErrWebhookPermissionDenied(), http.StatusForbidden},
		{"limit_reached", domain.ErrWebhookLimitReached(), http.StatusConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// Through errorResponse, so the webhook.* dispatch is covered too.
			got := errorResponse(tt.err)
			if got.StatusCode != tt.wantCode {
				t.Fatalf("status = %d, want %d", got.StatusCode, tt.wantCode)
			}
			if string(got.Response.Code) != tt.err.Code {
				t.Fatalf("code = %q, want %q", got.Response.Code, tt.err.Code)
			}
		})
	}
}
