//go:build integration

package helpers

import (
	"net/http"
	"testing"
	"time"
)

func (h *Harness) EnsureHttpClient(t *testing.T) *http.Client {
	t.Helper()
	if h.HttpClient == nil {
		h.HttpClient = &http.Client{
			Timeout: 5 * time.Minute,
		}
	}
	return h.HttpClient
}
