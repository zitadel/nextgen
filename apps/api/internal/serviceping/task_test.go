package serviceping

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/internal/background"
)

// The ping has no trigger, so a process that runs only while it serves a
// request refuses to start with it on, and sends nothing.
func TestTaskRequestBound(t *testing.T) {
	intake := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("a request-bound pinger sent a request")
	}))
	defer intake.Close()

	g := background.NewGroup(true)
	defer g.Close()
	err := g.Start(t.Context(), New(Config{Enabled: true, VercelEndpoint: intake.URL}, Facts{}).Task())
	if err == nil || !strings.Contains(err.Error(), "service ping cannot run where server.request_bound is set") || !strings.Contains(err.Error(), "service_ping.enabled") {
		t.Fatalf("start with the ping on: %v", err)
	}
	if err := g.Start(t.Context(), New(Config{VercelEndpoint: intake.URL}, Facts{}).Task()); err != nil {
		t.Fatalf("start with the ping off: %v", err)
	}
}

// A process that keeps running pings as it starts.
func TestTaskPingsInAProcessThatKeepsRunning(t *testing.T) {
	pinged := make(chan struct{}, 1)
	intake := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		pinged <- struct{}{}
	}))
	defer intake.Close()

	g := background.NewGroup(false)
	if err := g.Start(t.Context(), New(Config{Enabled: true, VercelEndpoint: intake.URL}, Facts{}).Task()); err != nil {
		t.Fatal(err)
	}
	<-pinged
	g.Close()
}
