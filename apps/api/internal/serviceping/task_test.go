package serviceping

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/internal/background"
)

// The ping goes out as the server starts and has no trigger. Where the
// platform starts and stops instances that would count starts, so the server
// refuses to start there with the ping on, and sends nothing.
func TestTaskWhereInstancesComeAndGo(t *testing.T) {
	intake := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("the pinger sent a request")
	}))
	defer intake.Close()

	for _, lifecycle := range []background.Lifecycle{background.ScaleToZero, background.RequestOnly} {
		t.Run(string(lifecycle), func(t *testing.T) {
			g := background.NewGroup(lifecycle)
			defer g.Close()
			err := g.Start(t.Context(), New(Config{Enabled: true, VercelEndpoint: intake.URL}, Facts{}).Task())
			if err == nil || !strings.Contains(err.Error(), "service ping cannot run where server.lifecycle is "+string(lifecycle)) || !strings.Contains(err.Error(), "service_ping.enabled") {
				t.Fatalf("start with the ping on: %v", err)
			}
			if err := g.Start(t.Context(), New(Config{VercelEndpoint: intake.URL}, Facts{}).Task()); err != nil {
				t.Fatalf("start with the ping off: %v", err)
			}
		})
	}
}

// An always-on server pings as it starts.
func TestTaskPingsAlwaysOn(t *testing.T) {
	pinged := make(chan struct{}, 1)
	intake := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		pinged <- struct{}{}
	}))
	defer intake.Close()

	g := background.NewGroup(background.AlwaysOn)
	if err := g.Start(t.Context(), New(Config{Enabled: true, VercelEndpoint: intake.URL}, Facts{}).Task()); err != nil {
		t.Fatal(err)
	}
	<-pinged
	g.Close()
}
