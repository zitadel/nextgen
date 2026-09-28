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
		//egress:allow integration-test harness talking to the server under test
		h.httpClient.value = &http.Client{
			Timeout: 5 * time.Minute,
		}
	}
	return h.httpClient.value
}
