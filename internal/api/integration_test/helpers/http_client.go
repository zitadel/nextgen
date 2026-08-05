package helpers

import (
	"net/http"
	"testing"
	"time"
)

func (h *Harness) EnsureHttpClient(t *testing.T) *http.Client {
	t.Helper()
	h.httpClient.mutex.Lock()
	defer h.httpClient.mutex.Unlock()

	if h.httpClient.value == nil {
		h.httpClient.value = &http.Client{
			Timeout: 5 * time.Minute,
		}
	}
	return h.httpClient.value
}
