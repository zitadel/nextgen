package ui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

type countingTransport struct {
	mu   sync.Mutex
	hits map[string]int
	base http.RoundTripper
}

func (t *countingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	host := req.URL.Scheme + "://" + req.URL.Host
	t.mu.Lock()
	if t.hits == nil {
		t.hits = map[string]int{}
	}
	t.hits[host]++
	t.mu.Unlock()
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(req)
}

func (t *countingTransport) hosts() map[string]int {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := map[string]int{}
	for k, v := range t.hits {
		out[k] = v
	}
	return out
}

func TestBuildTreeFromPlatformOnlyHitsPlatform(t *testing.T) {
	app, platformURL, euURL, mux := startPlatformEU(t)
	usURL, err := app.cellURLByLabel("us-2")
	if err != nil {
		t.Fatal(err)
	}

	spy := &countingTransport{base: http.DefaultTransport}
	app.Peer.HTTP = &http.Client{Transport: spy, Timeout: app.Peer.HTTP.Timeout}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("home status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `href="/cells/platform"`) {
		t.Fatal("home tree must link platform cell")
	}
	if strings.Contains(body, "Project tree") {
		t.Fatal("Cells page must not render project tree")
	}
	if strings.Contains(body, `hx-trigger="every 5s"`) {
		t.Fatal("Cells page must not auto-poll /tree")
	}

	hits := spy.hosts()
	platHost := cell.NormalizeURL(platformURL)
	euHost := cell.NormalizeURL(euURL)
	usHost := cell.NormalizeURL(usURL)
	if hits[platHost] == 0 {
		t.Fatalf("expected requests to platform %s; hits=%v", platHost, hits)
	}
	if hits[euHost] != 0 || hits[usHost] != 0 {
		t.Fatalf("Cells home must only contact platform; hits=%v", hits)
	}
}

func TestBuildTreeFromPlatformUnjoinedFromConfig(t *testing.T) {
	app, _, _, _ := startPlatformEU(t)
	roots, unjoined, err := app.buildTreeFromPlatform(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(roots) != 1 || roots[0].Label != "platform" {
		t.Fatalf("roots=%v", roots)
	}
	// No cell joins in this fixture → eu-1 and us-2 are unjoined (config diff).
	labels := map[string]bool{}
	for _, n := range unjoined {
		labels[n.Label] = true
	}
	if !labels["eu-1"] || !labels["us-2"] {
		t.Fatalf("unjoined=%v want eu-1 and us-2", unjoined)
	}
	if labels["platform"] {
		t.Fatal("platform must not appear in unjoined")
	}
}
