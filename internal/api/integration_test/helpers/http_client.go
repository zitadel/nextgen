package helpers

import (
	"net/http"
	"testing"
	"time"
)

func (h *Harness) EnsureHttpClient(t *testing.T) *http.Client {
	t.Helper()
	h.mu.Lock()
	client := h.HttpClient
	h.mu.Unlock()
	if client != nil {
		return client
	}
	client = &http.Client{
		Timeout: 5 * time.Minute,
	}
	h.mu.Lock()
	if h.HttpClient == nil {
		h.HttpClient = client
	}
	client = h.HttpClient
	h.mu.Unlock()
	return client
}
