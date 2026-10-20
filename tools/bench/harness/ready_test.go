package harness

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckReady(t *testing.T) {
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer healthy.Close()
	if err := CheckReady(t.Context(), healthy.URL); err != nil {
		t.Fatalf("healthy server: %v", err)
	}

	starting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer starting.Close()
	if err := CheckReady(t.Context(), starting.URL); err == nil {
		t.Fatal("503 from /healthz passed as ready")
	}

	gone := httptest.NewServer(http.NotFoundHandler())
	gone.Close()
	if err := CheckReady(t.Context(), gone.URL); err == nil {
		t.Fatal("closed server passed as ready")
	}
}
